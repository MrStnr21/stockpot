// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import * as v from 'valibot'

import type { BaseOverview, JsonFetch, NotesPage } from '../shared/types'
import { noteRowSchema, pageSchema, request, type ApiResult } from './notes-api'

/** A group of Base by its category: the category's id, or `'none'` for the uncategorized notes. */
export type GroupKey = number | 'none'

/** One page of Base: a group's kept notes, or the kept notes that match a search. */
export type BasePageQuery =
	| { readonly categoryId: GroupKey; readonly cursor: string | null }
	| { readonly q: string; readonly cursor: string | null }

export interface BaseApi {
	/** Every group's count and its most recently kept notes. */
	overview: (signal: AbortSignal) => Promise<ApiResult<BaseOverview>>
	/** One page, most recently kept first; `cursor` is the previous page's `nextCursor`. */
	page: (query: BasePageQuery, signal: AbortSignal) => Promise<ApiResult<NotesPage>>
}

export interface BaseApiOptions {
	readonly fetch: JsonFetch
}

const count = v.pipe(v.number(), v.integer(), v.minValue(0))

const id = v.pipe(v.number(), v.integer(), v.minValue(1))

const groupSchema = v.object({
	categoryId: v.nullable(id),
	count,
	notes: v.array(noteRowSchema),
})

export const baseOverviewSchema = v.object({
	total: count,
	groups: v.array(groupSchema),
}) satisfies v.GenericSchema<unknown, BaseOverview>

function pageSearch(query: BasePageQuery): string {
	const params = new URLSearchParams(
		'q' in query ? { q: query.q } : { categoryId: String(query.categoryId) },
	)

	if (query.cursor !== null) {
		params.set('cursor', query.cursor)
	}

	return `?${params.toString()}`
}

/** Base's requests over an injected `fetch`, each answer parsed before Base reads it. */
export function createBaseApi({ fetch }: BaseApiOptions): BaseApi {
	return {
		overview: async (signal) =>
			request(async () => fetch('/api/base', { signal }), baseOverviewSchema),
		page: async (query, signal) =>
			request(async () => fetch(`/api/base/notes${pageSearch(query)}`, { signal }), pageSchema),
	}
}
