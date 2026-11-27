// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

/*
 * Base's state as plain values, and what follows from it: the rows each group draws, the rows in
 * the order they are drawn, and the empty state.
 */
import type { BaseOverview, NoteRow, NotesPage } from '../shared/types'
import type { GroupKey } from './base-api'
import { groupKey } from './base-view'

/** The search on screen, or on its way. */
export interface BaseSearch {
	/** The search as sent, trimmed. */
	readonly query: string
	readonly rows: readonly NoteRow[]
	/** How many kept notes match; `null` until the first answer. */
	readonly total: number | null
	readonly nextCursor: string | null
	readonly isLoading: boolean
	readonly isLoadingMore: boolean
}

/** A group shown in full: its pages so far, or its preview while the first page loads. */
export interface ExpandedGroup {
	readonly rows: readonly NoteRow[]
	readonly nextCursor: string | null
	readonly isLoading: boolean
}

export type ExpandedGroups = ReadonlyMap<GroupKey, ExpandedGroup>

/** Which empty state Base shows: nothing kept at all, or a search that found nothing. */
export type BaseEmpty = 'base' | 'search'

/** The rows of `next` that `rows` does not show yet, after them. */
export function appended(rows: readonly NoteRow[], next: readonly NoteRow[]): readonly NoteRow[] {
	const shown = new Set(rows.map(({ id }) => id))

	return [...rows, ...next.filter(({ id }) => !shown.has(id))]
}

/** A search's first page on its way: the rows on screen stay until it answers. */
export function searchStarted(previous: BaseSearch | null, query: string): BaseSearch {
	return {
		query,
		rows: previous?.rows ?? [],
		total: previous?.total ?? null,
		nextCursor: null,
		isLoading: true,
		isLoadingMore: false,
	}
}

/** A search page answered: the first page replaces the rows, a later one adds to them. */
export function searchAnswered(search: BaseSearch, page: NotesPage, isMore: boolean): BaseSearch {
	return {
		query: search.query,
		rows: isMore ? appended(search.rows, page.notes) : page.notes,
		total: page.total ?? search.total ?? page.notes.length,
		nextCursor: page.nextCursor,
		isLoading: false,
		isLoadingMore: false,
	}
}

/** Whether the flat results replace the groups: once a search has answered. */
export function showsSearch(search: BaseSearch | null): search is BaseSearch {
	return search !== null && search.total !== null
}

/** The rows a group draws: all its pages once expanded, else its preview. */
export function groupRows(
	overview: BaseOverview,
	expanded: ExpandedGroups,
	categoryId: number | null,
): readonly NoteRow[] {
	return (
		expanded.get(groupKey(categoryId))?.rows ??
		overview.groups.find((group) => group.categoryId === categoryId)?.notes ??
		[]
	)
}

/** The rows in the order they are drawn: the results, or every group's rows. */
export function drawnRows(
	overview: BaseOverview,
	expanded: ExpandedGroups,
	search: BaseSearch | null,
): readonly NoteRow[] {
	if (showsSearch(search)) {
		return search.rows
	}

	return overview.groups.flatMap(({ categoryId }) => groupRows(overview, expanded, categoryId))
}

/** Nothing kept and no search, or a settled search with no rows; `null` otherwise. */
export function baseEmpty(overview: BaseOverview, search: BaseSearch | null): BaseEmpty | null {
	if (search === null) {
		return overview.total === 0 ? 'base' : null
	}

	const isSettled = search.total !== null && !search.isLoading

	return isSettled && search.rows.length === 0 ? 'search' : null
}
