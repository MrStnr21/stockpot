// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

/*
 * Base's state: the overview of kept notes by category, the groups shown in full, and the search.
 * Each loads over its own request channel, so a newer request on it makes an older answer stale.
 * Failed requests keep the rows on screen.
 */
import { normalizeQuery } from '../shared/filters'
import type { BaseOverview, NoteRow, NotesPage } from '../shared/types'
import type { BaseApi, GroupKey } from './base-api'
import {
	appended,
	baseEmpty,
	drawnRows,
	groupRows,
	searchAnswered,
	searchStarted,
	showsSearch,
	type BaseEmpty,
	type BaseSearch,
	type ExpandedGroup,
	type ExpandedGroups,
} from './base-state'
import { groupKey } from './base-view'
import { queryDebounceMs } from './list-loader'
import { errorToast, NotesToasts } from './notes-toasts.svelte'
import { RequestChannels, type ChannelAnswer } from './request-channels'

export interface BaseControllerOptions {
	/** The overview as the server rendered it. */
	readonly initial: BaseOverview
	readonly api: BaseApi
	readonly strings: { readonly loadFailedToast: string }
	readonly signIn?: () => void
	readonly toasts?: NotesToasts
}

function signInPage() {
	globalThis.location.assign('/signin')
}

const searchChannel = 'search'

function groupChannel(key: GroupKey) {
	return `group:${String(key)}`
}

export class BaseController {
	declare public overview: BaseOverview
	/** The search field as typed; Base searches it after a pause. */
	declare public query: string
	declare public search: BaseSearch | null
	declare public expanded: ExpandedGroups

	public readonly toasts: NotesToasts

	/** Whether the flat results replace the groups: once a search has answered. */
	declare public readonly showsSearch: boolean

	declare public readonly empty: BaseEmpty | null

	/** The rows in the order they are drawn, for the arrow keys. */
	declare public readonly drawnRows: readonly NoteRow[]

	readonly #api: BaseApi
	readonly #strings: BaseControllerOptions['strings']
	readonly #signIn: () => void
	readonly #channels = new RequestChannels()

	#timer: ReturnType<typeof setTimeout> | null = null

	public constructor(options: BaseControllerOptions) {
		this.#api = options.api
		this.#strings = options.strings
		this.#signIn = options.signIn ?? signInPage
		this.toasts = options.toasts ?? new NotesToasts()
		this.overview = $state.raw(options.initial)
		this.query = $state('')
		this.search = $state.raw(null)
		this.expanded = $state.raw(new Map())

		this.showsSearch = $derived(showsSearch(this.search))
		this.empty = $derived(baseEmpty(this.overview, this.search))
		this.drawnRows = $derived(drawnRows(this.overview, this.expanded, this.search))
	}

	/** The rows a group draws: all its pages once expanded, else its preview. */
	public rowsOf(categoryId: number | null): readonly NoteRow[] {
		return groupRows(this.overview, this.expanded, categoryId)
	}

	/** The search field changed: Base searches after a pause; a blank field clears the search at once. */
	public typeQuery(text: string): void {
		this.query = text
		this.#clearTimer()

		const query = normalizeQuery(text)

		if (query === '') {
			this.#dropSearch()

			return
		}

		this.#timer = setTimeout(() => {
			this.#timer = null
			this.#runSearch(query).catch(() => null)
		}, queryDebounceMs)
	}

	/** "Clear search": back to the groups at once. */
	public clearSearch(): void {
		this.query = ''
		this.#clearTimer()
		this.#dropSearch()
	}

	/** The next page of results, once: never while a page of them is on its way. */
	public async loadMoreResults(): Promise<void> {
		const { search } = this

		if (search === null || search.isLoading || search.isLoadingMore || search.nextCursor === null) {
			return
		}

		this.search = { ...search, isLoadingMore: true }

		const answer = await this.#channels.send(searchChannel, async (signal) =>
			this.#api.page({ q: search.query, cursor: search.nextCursor }, signal),
		)

		this.#settleSearch(answer, true)
	}

	/** "Show all": the group's first page in place of its preview. */
	public async showAll(key: GroupKey): Promise<void> {
		const preview = this.overview.groups.find((group) => groupKey(group.categoryId) === key)

		this.#setGroup(key, {
			rows: this.expanded.get(key)?.rows ?? preview?.notes ?? [],
			nextCursor: null,
			isLoading: true,
		})
		await this.#loadGroup(key, null)
	}

	/** "Show less": back to the preview, whatever was on its way. */
	public showLess(key: GroupKey): void {
		this.#channels.cancel(groupChannel(key))

		const next = new Map(this.expanded)

		next.delete(key)
		this.expanded = next
	}

	/** "Show more" in an expanded group: its next page, once. */
	public async loadMoreIn(key: GroupKey): Promise<void> {
		const group = this.expanded.get(key)

		if (group === undefined || group.isLoading || group.nextCursor === null) {
			return
		}

		this.#setGroup(key, { ...group, isLoading: true })
		await this.#loadGroup(key, group.nextCursor)
	}

	/**
	 * Notes changed elsewhere: the overview again, the search's first page, and the first page of
	 * each expanded group (the pages loaded past it are dropped). The rows stay meanwhile.
	 */
	public async reload(): Promise<void> {
		const { search } = this
		const loads: Promise<void>[] = [this.#loadOverview()]

		if (search !== null) {
			loads.push(this.#runSearch(search.query))
		}

		for (const [key, group] of this.expanded) {
			this.#setGroup(key, { ...group, isLoading: true })
			loads.push(this.#loadGroup(key, null))
		}

		await Promise.all(loads)
	}

	public destroy(): void {
		this.#clearTimer()
		this.#channels.stop()
		this.toasts.destroy()
	}

	async #loadOverview() {
		const answer = await this.#channels.send('overview', async (signal) =>
			this.#api.overview(signal),
		)

		if (answer.kind === 'stale') {
			return
		}

		if (answer.kind !== 'ok') {
			this.#failed(answer.kind)

			return
		}

		this.overview = answer.value

		// A group that has no kept notes left is no longer drawn: it stops loading.
		const keys = new Set(answer.value.groups.map(({ categoryId }) => groupKey(categoryId)))

		for (const key of this.expanded.keys()) {
			if (!keys.has(key)) {
				this.showLess(key)
			}
		}
	}

	async #runSearch(query: string) {
		this.search = searchStarted(this.search, query)

		const answer = await this.#channels.send(searchChannel, async (signal) =>
			this.#api.page({ q: query, cursor: null }, signal),
		)

		this.#settleSearch(answer, false)
	}

	#settleSearch(answer: ChannelAnswer<NotesPage>, isMore: boolean) {
		const { search } = this

		if (answer.kind === 'stale' || search === null) {
			return
		}

		if (answer.kind === 'ok') {
			this.search = searchAnswered(search, answer.value, isMore)

			return
		}

		this.search = { ...search, isLoading: false, isLoadingMore: false }
		this.#failed(answer.kind)
	}

	async #loadGroup(key: GroupKey, cursor: string | null) {
		const answer = await this.#channels.send(groupChannel(key), async (signal) =>
			this.#api.page({ categoryId: key, cursor }, signal),
		)

		const group = this.expanded.get(key)

		if (answer.kind === 'stale' || group === undefined) {
			return
		}

		if (answer.kind !== 'ok') {
			this.#setGroup(key, { ...group, isLoading: false })
			this.#failed(answer.kind)

			return
		}

		const page = answer.value

		this.#setGroup(key, {
			rows: cursor === null ? page.notes : appended(group.rows, page.notes),
			nextCursor: page.nextCursor,
			isLoading: false,
		})
	}

	#dropSearch() {
		this.#channels.cancel(searchChannel)
		this.search = null
	}

	#setGroup(key: GroupKey, group: ExpandedGroup) {
		this.expanded = new Map(this.expanded).set(key, group)
	}

	#clearTimer() {
		if (this.#timer !== null) {
			clearTimeout(this.#timer)
			this.#timer = null
		}
	}

	#failed(kind: 'unauthorized' | 'invalid' | 'failed') {
		if (kind === 'unauthorized') {
			this.#signIn()
		} else {
			this.toasts.show(errorToast(this.#strings.loadFailedToast))
		}
	}
}
