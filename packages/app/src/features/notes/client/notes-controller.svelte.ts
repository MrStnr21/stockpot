// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { facetCounts, type Facets } from '../shared/facets'
import { filtersSearch, sameFilters, type NoteFilters } from '../shared/filters'
import type { CountRow, JsonFetch, NotesCategory, NotesPage, NoteStatus } from '../shared/types'
import { sendBulk, type BulkAction, type BulkSettlement } from './bulk'
import { groupByDay, type DayGroup } from './day-groups'
import {
	emptyKind,
	ListLoader,
	type EmptyKind,
	type ListFailure,
	type ListView,
} from './list-loader'
import { createNotesApi, type NotesApi } from './notes-api'
import { bulkToast, errorToast, NotesToasts, type NotesStrings } from './notes-toasts.svelte'
import { replaceFiltersUrl } from './open-note'
import {
	keepSelected,
	noSelection,
	pressNote,
	startSelecting,
	toggleNote,
	type Selection,
	type SelectOutcome,
} from './selection'

export type { NotesStrings } from './notes-toasts.svelte'

export interface NotesControllerOptions {
	/** The first page as the server rendered it. */
	readonly initial: NotesPage
	readonly counts: readonly CountRow[]
	readonly categories: readonly NotesCategory[]
	readonly filters: NoteFilters
	/** The instance's time zone, for the day groups. */
	readonly timeZone: string
	readonly locale: string
	/** When the server rendered the page, so the island draws the same day groups. */
	readonly renderedAt: number
	readonly strings: NotesStrings
	readonly fetch: JsonFetch
	readonly signIn?: () => void
	/** Puts the filters into the page's URL, so a reload renders the same view. */
	readonly writeUrl?: (search: string) => void
	readonly now?: () => number
}

function signInPage() {
	globalThis.location.assign('/signin')
}

/** The notes list's state: rows and filters, counts, select mode, bulk actions and toasts. */
export class NotesController {
	declare public view: ListView
	declare public counts: readonly CountRow[]
	/** The search field as typed; the list follows it after a pause. */
	declare public query: string

	public selection = $state.raw<Selection>(noSelection)

	/** The bulk action on its way: every bulk button waits for it. */
	public running = $state.raw<BulkAction['kind'] | null>(null)

	public readonly toasts = new NotesToasts()

	public readonly categories: readonly NotesCategory[]

	declare public readonly facets: Facets

	/** Day groups; none while searching, where the results are one flat list. */
	declare public readonly groups: DayGroup[] | null

	declare public readonly selected: ReadonlySet<number>

	declare public readonly empty: EmptyKind | null

	/** Whether the bulk buttons take a press. */
	declare public readonly canAct: boolean

	readonly #api: NotesApi
	readonly #loader: ListLoader
	readonly #strings: NotesStrings
	readonly #signIn: () => void
	readonly #writeUrl: (search: string) => void

	#countsSequence = 0
	#countsController: AbortController | null = null

	public constructor(options: NotesControllerOptions) {
		this.categories = options.categories
		this.#strings = options.strings
		this.#signIn = options.signIn ?? signInPage
		this.#writeUrl = options.writeUrl ?? replaceFiltersUrl
		this.#api = createNotesApi({ fetch: options.fetch })
		this.#loader = new ListLoader({
			api: this.#api,
			initial: options.initial,
			filters: options.filters,
			renderedAt: options.renderedAt,
			now: options.now,
			onChange: (view) => {
				this.#follow(view)
			},
			onFailure: (failure) => {
				this.#failed(failure, this.#strings.loadFailedToast)
			},
		})
		this.view = $state.raw(this.#loader.view)
		this.counts = $state.raw(options.counts)
		this.query = $state(options.filters.q)

		// Derived after the state they read, which the constructor sets.
		this.facets = $derived(facetCounts(this.counts, this.view.filters))
		this.groups = $derived(
			this.view.filters.q === ''
				? groupByDay(this.view.rows, {
						now: this.view.now,
						timeZone: options.timeZone,
						locale: options.locale,
						labels: options.strings,
					})
				: null,
		)
		this.selected = $derived(new Set(this.selection.ids))
		this.empty = $derived(emptyKind(this.view, this.facets.total))
		this.canAct = $derived(this.running === null && this.selection.ids.length > 0)
	}

	public typeQuery(text: string): void {
		this.query = text
		this.#loader.typeQuery(text)
	}

	public setStatus(status: NoteStatus | null): void {
		this.#loader.setFilters({ status })
	}

	public setCategory(categoryId: number | null): void {
		this.#loader.setFilters({ categoryId })
	}

	/** "Clear search": the search only, at once. */
	public clearSearch(): void {
		this.query = ''
		this.#loader.setFilters({ q: '' })
	}

	/** "Clear filters": the status and the category, at once. */
	public clearFilters(): void {
		this.#loader.setFilters({ status: null, categoryId: null })
	}

	public loadMore(): void {
		this.#loader.loadMore()
	}

	/** A note was saved or removed elsewhere on this page: the first page and the counts again. */
	public notesChanged(): void {
		this.#loader.reload()
		this.refreshCounts().catch(() => null)
	}

	public startSelecting(): void {
		this.selection = startSelecting(this.selection)
	}

	/** A tap on a row in select mode. */
	public toggle(id: number): void {
		this.#select(toggleNote(this.selection, id))
	}

	/** A long press on a row. */
	public press(id: number): void {
		this.#select(pressNote(this.selection, id))
	}

	/** "Done" or Escape: select mode ends and the selection goes. */
	public done(): void {
		this.selection = noSelection
	}

	/**
	 * Every bulk button calls this. One action at a time, set before the request leaves, so a double
	 * tap sends once. The rows change only from the answer.
	 */
	public async run(action: BulkAction): Promise<void> {
		const { ids } = this.selection

		if (this.running !== null || ids.length === 0) {
			return
		}

		this.running = action.kind
		this.#loader.hold()

		try {
			const result = await sendBulk(this.#api, {
				action,
				ids,
				rows: () => this.view.rows,
			})

			if (result.kind === 'ok') {
				this.#settle(result.value)
			} else {
				this.#failed(
					result.kind === 'unauthorized' ? 'unauthorized' : 'failed',
					this.#strings.bulkFailedToast,
				)
			}
		} finally {
			this.running = null
			this.#loader.release()
		}
	}

	/** The latest request wins: an answer to an older one is dropped. */
	public async refreshCounts(): Promise<void> {
		this.#countsSequence += 1

		const sequence = this.#countsSequence
		const controller = new AbortController()

		this.#countsController?.abort()
		this.#countsController = controller

		const result = await this.#api.counts(controller.signal)

		if (sequence !== this.#countsSequence) {
			return
		}

		this.#countsController = null

		if (result.kind === 'ok') {
			this.counts = result.value
		} else if (result.kind === 'unauthorized') {
			this.#signIn()
		}
	}

	public destroy(): void {
		this.#loader.stop()
		this.#countsSequence += 1
		this.#countsController?.abort()
		this.toasts.destroy()
	}

	#settle({ patches, keep, summary }: BulkSettlement) {
		const categoryId = summary.action.kind === 'move' ? summary.action.categoryId : null
		const category = this.categories.find(({ id }) => id === categoryId)

		this.#loader.applyPatches(patches)
		this.selection = keepSelected(this.selection, keep)
		this.toasts.show(bulkToast(this.#strings, summary, category?.name ?? ''))
		this.refreshCounts().catch(() => null)
	}

	#select({ selection, isRefused }: SelectOutcome) {
		this.selection = selection

		if (isRefused) {
			this.toasts.show(errorToast(this.#strings.selectLimitToast))
		}
	}

	#failed(failure: ListFailure, message: string) {
		if (failure === 'unauthorized') {
			this.#signIn()
		} else {
			this.toasts.show(errorToast(message))
		}
	}

	#follow(view: ListView) {
		const previous = this.view.filters

		this.view = view

		if (!sameFilters(previous, view.filters)) {
			this.#writeUrl(filtersSearch(view.filters))
		}
	}
}
