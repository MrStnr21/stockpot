// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

/*
 * The list's filters and search, and their place in the page's URL (`?status=`, `?categoryId=`,
 * `?q=`), so a reload renders the same view. The page reads them on the server and the island writes
 * them back; a value that does not parse is dropped rather than refused, so the page never answers 400.
 */
import * as v from 'valibot'

import { listStatuses, type NoteRow, type NoteStatus } from './types'

export interface NoteFilters {
	readonly status: NoteStatus | null
	readonly categoryId: number | null
	/** The trimmed search; empty means no search. */
	readonly q: string
}

export const noFilters: NoteFilters = { status: null, categoryId: null, q: '' }

/** The longest search `GET /api/notes` takes, in characters as a person counts them. */
export const maxQueryLength = 200

const statusParam = v.picklist(listStatuses)

const categoryParam = v.pipe(v.string(), v.regex(/^[1-9]\d{0,14}$/u), v.transform(Number))

const queryParam = v.pipe(v.string(), v.trim(), v.maxGraphemes(maxQueryLength))

/** What the search field holds, as the list searches it. */
export function normalizeQuery(text: string): string {
	return text.trim()
}

function readParam<T>(params: URLSearchParams, name: string, schema: v.GenericSchema<string, T>) {
	const value = params.get(name)

	if (value === null) {
		return null
	}

	const parsed = v.safeParse(schema, value)

	return parsed.success ? parsed.output : null
}

/**
 * The filters a URL names. Each parameter is read on its own, so one bad value drops only itself; a
 * category the instance does not have is dropped too.
 */
export function readFilters(params: URLSearchParams, categoryIds: readonly number[]): NoteFilters {
	const categoryId = readParam(params, 'categoryId', categoryParam)

	return {
		status: readParam(params, 'status', statusParam),
		categoryId: categoryId !== null && categoryIds.includes(categoryId) ? categoryId : null,
		q: readParam(params, 'q', queryParam) ?? '',
	}
}

/** The URL parameters of these filters; an empty one is left out. */
export function filtersToParams(filters: NoteFilters): URLSearchParams {
	const params = new URLSearchParams()

	if (filters.status !== null) {
		params.set('status', filters.status)
	}

	if (filters.categoryId !== null) {
		params.set('categoryId', String(filters.categoryId))
	}

	if (filters.q !== '') {
		params.set('q', filters.q)
	}

	return params
}

/** The page's `search` for these filters: empty, or `?` and the parameters. */
export function filtersSearch(filters: NoteFilters): string {
	const params = filtersToParams(filters).toString()

	return params === '' ? '' : `?${params}`
}

/** The query of `GET /api/notes` for one page of this view. */
export function pageSearch(filters: NoteFilters, cursor: string | null): string {
	const params = filtersToParams(filters)

	if (cursor !== null) {
		params.set('cursor', cursor)
	}

	const text = params.toString()

	return text === '' ? '' : `?${text}`
}

export function sameFilters(first: NoteFilters, second: NoteFilters): boolean {
	return (
		first.status === second.status && first.categoryId === second.categoryId && first.q === second.q
	)
}

/**
 * Whether a row still belongs in a view after a change. Only the status and the category are judged:
 * a change never touches the text the search matched.
 */
export function rowMatchesFilters(
	row: Pick<NoteRow, 'status' | 'categoryId'>,
	filters: NoteFilters,
): boolean {
	return (
		(filters.status === null || row.status === filters.status) &&
		(filters.categoryId === null || row.categoryId === filters.categoryId)
	)
}
