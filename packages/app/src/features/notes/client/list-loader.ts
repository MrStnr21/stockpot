// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

/*
 * The rows of the notes list and the requests that fill them. Every view request carries the
 * generation it was sent in; a change of the filters or the search starts a new one and aborts the
 * requests of the old. An answer applies only while its generation is current and its own request
 * was not aborted, since an abort can lose the race with a body that has already arrived. Load-more
 * appends only rows not shown yet, and bulk answers reach late list answers through `RowPatches`.
 */
import { normalizeQuery, sameFilters, type NoteFilters } from '../shared/filters'
import type { NoteRow, NotesPage } from '../shared/types'
import type { ApiResult, NotesApi } from './notes-api'
import { RowPatches, type RowPatch } from './row-patches'

/** Typing pauses this long before the list searches. */
export const queryDebounceMs = 250

export interface ListView {
	readonly rows: readonly NoteRow[]
	/** The next page's cursor; none after the last page, or while a first page loads. */
	readonly nextCursor: string | null
	/** Only with a search: how many notes match. */
	readonly total: number | null
	/** The filters the list shows, or is loading. */
	readonly filters: NoteFilters
	/** A first page is on its way: the old rows stay meanwhile. */
	readonly isLoading: boolean
	readonly isLoadingMore: boolean
	/** The time the rows' day groups are judged against: when their first page arrived. */
	readonly now: number
}

export type ListFailure = 'failed' | 'unauthorized'

export interface ListLoaderOptions {
	readonly api: Pick<NotesApi, 'listPage'>
	/** The first page as the server rendered it. */
	readonly initial: NotesPage
	readonly filters: NoteFilters
	readonly renderedAt: number
	readonly onChange: (view: ListView) => void
	readonly onFailure: (failure: ListFailure) => void
	readonly now?: () => number
}

/** Which empty state the list shows, if any. */
export type EmptyKind = 'instance' | 'search' | 'filters'

/** The empty state for a settled view, or null while it has rows or a first page is on its way. */
export function emptyKind(view: ListView, total: number): EmptyKind | null {
	if (view.rows.length > 0 || view.isLoading) {
		return null
	}

	if (view.filters.q !== '') {
		return 'search'
	}

	const isFiltered = view.filters.status !== null || view.filters.categoryId !== null

	return isFiltered && total > 0 ? 'filters' : 'instance'
}

interface ViewRequest {
	readonly kind: 'first' | 'more'
	readonly generation: number
	/** The patches' clock when it was sent. */
	readonly sentAt: number
	readonly controller: AbortController
}

export class ListLoader {
	readonly #api: Pick<NotesApi, 'listPage'>
	readonly #onChange: (view: ListView) => void
	readonly #onFailure: (failure: ListFailure) => void
	readonly #now: () => number
	readonly #inFlight = new Set<ViewRequest>()
	readonly #patches = new RowPatches()

	#view: ListView
	/** The filters and the cursor of the rows on screen, kept when a first page fails. */
	#shown: Pick<ListView, 'filters' | 'nextCursor'>
	#generation = 0
	/** The search field as typed, applied after the pause or with the next filter change. */
	#field: string
	#timer: ReturnType<typeof setTimeout> | null = null
	#isHeld = false
	#wantsMore = false

	public constructor(options: ListLoaderOptions) {
		const { initial, filters } = options

		this.#api = options.api
		this.#onChange = options.onChange
		this.#onFailure = options.onFailure
		this.#now = options.now ?? (() => Date.now())
		this.#field = filters.q
		this.#shown = { filters, nextCursor: initial.nextCursor }
		this.#view = {
			rows: initial.notes,
			nextCursor: initial.nextCursor,
			total: initial.total,
			filters,
			isLoading: false,
			isLoadingMore: false,
			now: options.renderedAt,
		}
	}

	public get view(): ListView {
		return this.#view
	}

	/** The search field changed: the list searches after a pause in typing. */
	public typeQuery(text: string): void {
		this.#field = text
		this.#clearTimer()
		this.#timer = setTimeout(() => {
			this.#timer = null
			this.#change({})
		}, queryDebounceMs)
	}

	/** A chip, the category sheet or a clear button: applies at once, with the search typed so far. */
	public setFilters(change: Partial<NoteFilters>): void {
		if (change.q !== undefined) {
			this.#field = change.q
		}

		this.#change(change)
	}

	/** Notes changed elsewhere: the first page again with the current filters, the rows kept meanwhile. */
	public reload(): void {
		this.#clearTimer()
		this.#loadFirst({ ...this.#view.filters, q: normalizeQuery(this.#field) })
	}

	/** The next page, once: never while a first page or another page is on its way. */
	public loadMore(): void {
		const { nextCursor, isLoading, isLoadingMore, filters } = this.#view

		if (nextCursor === null || isLoading || isLoadingMore) {
			return
		}

		if (this.#isHeld) {
			this.#wantsMore = true

			return
		}

		this.#update({ isLoadingMore: true })
		this.#send('more', filters, nextCursor)
	}

	/** A bulk request is on its way: a page in flight is aborted and asked again on release. */
	public hold(): void {
		this.#isHeld = true

		for (const request of this.#inFlight) {
			if (request.kind === 'more') {
				request.controller.abort()
				this.#inFlight.delete(request)
				this.#wantsMore = true
				this.#update({ isLoadingMore: false })
			}
		}
	}

	public release(): void {
		this.#isHeld = false

		if (this.#wantsMore) {
			this.#wantsMore = false
			this.loadMore()
		}
	}

	/** A bulk answer: patches the loaded rows now, and every list answer sent before it later. */
	public applyPatches(patches: ReadonlyMap<number, RowPatch>): void {
		const { rows, filters } = this.#view

		this.#update({ rows: this.#patches.record(patches, rows, filters) })
	}

	/** The island is gone: no timer fires and no answer applies. */
	public stop(): void {
		this.#clearTimer()
		this.#generation += 1
		this.#abortAll()
	}

	#change(change: Partial<NoteFilters>) {
		this.#clearTimer()

		const current = this.#view.filters

		const filters: NoteFilters = {
			status: change.status === undefined ? current.status : change.status,
			categoryId: change.categoryId === undefined ? current.categoryId : change.categoryId,
			q: normalizeQuery(this.#field),
		}

		if (!sameFilters(filters, current)) {
			this.#loadFirst(filters)
		}
	}

	#loadFirst(filters: NoteFilters) {
		this.#generation += 1
		this.#abortAll()
		this.#wantsMore = false

		this.#update({ filters, nextCursor: null, isLoading: true, isLoadingMore: false })
		this.#send('first', filters, null)
	}

	#send(kind: ViewRequest['kind'], filters: NoteFilters, cursor: string | null) {
		const request: ViewRequest = {
			kind,
			generation: this.#generation,
			sentAt: this.#patches.stamp(),
			controller: new AbortController(),
		}

		this.#inFlight.add(request)
		this.#api
			.listPage(filters, cursor, request.controller.signal)
			.then((result) => {
				this.#settle(request, result)
			})
			.catch(() => null)
	}

	/** An answer applies only while its generation is current and its request was not aborted. */
	#settle(request: ViewRequest, result: ApiResult<NotesPage>) {
		if (request.generation !== this.#generation || request.controller.signal.aborted) {
			return
		}

		this.#inFlight.delete(request)

		if (result.kind === 'ok') {
			this.#show(request, result.value)

			return
		}

		// After a failed first page, the rows on screen keep the filters and the cursor they belong to.
		this.#update(
			request.kind === 'first' ? { ...this.#shown, isLoading: false } : { isLoadingMore: false },
		)
		this.#onFailure(result.kind === 'unauthorized' ? 'unauthorized' : 'failed')
	}

	#show(request: ViewRequest, { notes, nextCursor, total }: NotesPage) {
		const { rows, filters } = this.#view
		const merged = this.#patches.merge(notes, request.sentAt, filters)

		this.#shown = { filters, nextCursor }

		if (request.kind === 'more') {
			const shown = new Set(rows.map(({ id }) => id))

			this.#update({
				rows: [...rows, ...merged.filter(({ id }) => !shown.has(id))],
				nextCursor,
				total,
				isLoadingMore: false,
			})

			return
		}

		this.#patches.dropBefore(request.sentAt)
		this.#update({ rows: merged, nextCursor, total, isLoading: false, now: this.#now() })
	}

	#abortAll() {
		for (const request of this.#inFlight) {
			request.controller.abort()
		}

		this.#inFlight.clear()
	}

	#clearTimer() {
		if (this.#timer !== null) {
			clearTimeout(this.#timer)
			this.#timer = null
		}
	}

	#update(change: Partial<ListView>) {
		this.#view = { ...this.#view, ...change }
		this.#onChange(this.#view)
	}
}
