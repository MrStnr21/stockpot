// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import * as v from 'valibot'

import { pageSearch, type NoteFilters } from '../shared/filters'
import {
	listStatuses,
	type ChangeResult,
	type CountRow,
	type JsonFetch,
	type NoteRow,
	type NotesChange,
	type NotesPage,
	type ResearchResult,
} from '../shared/types'

/**
 * How a request ended: its parsed answer, a 401 (signed out), a 400 (the server refused what was
 * sent), or anything else: a network error, an abort, another status or an answer that does not parse.
 */
export type ApiResult<T> =
	| { readonly kind: 'ok'; readonly value: T }
	| { readonly kind: 'unauthorized' }
	| { readonly kind: 'invalid' }
	| { readonly kind: 'failed' }

export interface NotesApi {
	/** One page of the view, newest first; `cursor` is the previous page's `nextCursor`. */
	listPage: (
		filters: NoteFilters,
		cursor: string | null,
		signal: AbortSignal,
	) => Promise<ApiResult<NotesPage>>
	counts: (signal: AbortSignal) => Promise<ApiResult<readonly CountRow[]>>
	researchNow: (ids: readonly number[]) => Promise<ApiResult<readonly ResearchResult[]>>
	changeNotes: (
		ids: readonly number[],
		change: NotesChange,
	) => Promise<ApiResult<readonly ChangeResult[]>>
}

export interface NotesApiOptions {
	readonly fetch: JsonFetch
}

const id = v.pipe(v.number(), v.integer(), v.minValue(1))

const count = v.pipe(v.number(), v.integer(), v.minValue(0))

const status = v.picklist(listStatuses)

const isoDate = v.pipe(v.string(), v.isoTimestamp())

const segment = v.object({ text: v.string(), match: v.boolean() })

export const noteRowSchema = v.object({
	id,
	text: v.string(),
	context: v.nullable(v.string()),
	url: v.nullable(v.string()),
	source: v.string(),
	categoryId: v.nullable(id),
	status,
	private: v.boolean(),
	createdAt: isoDate,
	updatedAt: isoDate,
	sense: v.nullable(v.string()),
	flag: v.nullable(v.picklist(['draft', 'unsure'])),
	snippet: v.nullable(v.array(segment)),
}) satisfies v.GenericSchema<unknown, NoteRow>

export const pageSchema = v.object({
	notes: v.array(noteRowSchema),
	nextCursor: v.nullable(v.string()),
	total: v.nullable(count),
}) satisfies v.GenericSchema<unknown, NotesPage>

const countRow = v.object({ categoryId: v.nullable(id), status, count })

const countsSchema = v.pipe(
	v.object({ counts: v.array(countRow) }),
	v.transform(({ counts }) => counts),
) satisfies v.GenericSchema<unknown, readonly CountRow[]>

const researchResult = v.object({
	id,
	outcome: v.picklist(['queued', 'pending', 'done', 'not_found']),
})

const researchSchema = v.pipe(
	v.object({ results: v.array(researchResult) }),
	v.transform(({ results }) => results),
) satisfies v.GenericSchema<unknown, readonly ResearchResult[]>

const changedNote = v.object({ status, categoryId: v.nullable(id) })

const changeResult = v.object({
	id,
	outcome: v.picklist(['changed', 'unchanged', 'not_found', 'conflict']),
	note: v.nullable(changedNote),
})

const changeSchema = v.pipe(
	v.object({ results: v.array(changeResult) }),
	v.transform(({ results }) => results),
) satisfies v.GenericSchema<unknown, readonly ChangeResult[]>

export async function request<T>(
	send: () => Promise<Response>,
	schema: v.GenericSchema<unknown, T>,
): Promise<ApiResult<T>> {
	try {
		const response = await send()

		if (response.status === 401) {
			return { kind: 'unauthorized' }
		}

		if (response.status === 400) {
			return { kind: 'invalid' }
		}

		if (response.status !== 200) {
			return { kind: 'failed' }
		}

		const parsed = v.safeParse(schema, await response.json())

		return parsed.success ? { kind: 'ok', value: parsed.output } : { kind: 'failed' }
	} catch {
		return { kind: 'failed' }
	}
}

interface IdsBody {
	readonly ids: readonly number[]
}

type BulkBody = IdsBody | (IdsBody & NotesChange)

function jsonInit(
	method: 'PATCH' | 'POST',
	body: BulkBody,
): RequestInit & { readonly body: string } {
	return { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
}

/** The list's requests over an injected `fetch`, each answer parsed before the list reads it. */
export function createNotesApi({ fetch }: NotesApiOptions): NotesApi {
	return {
		listPage: async (filters, cursor, signal) =>
			request(
				async () => fetch(`/api/notes${pageSearch(filters, cursor)}`, { signal }),
				pageSchema,
			),
		counts: async (signal) =>
			request(async () => fetch('/api/notes/counts', { signal }), countsSchema),
		researchNow: async (ids) =>
			request(async () => fetch('/api/notes/research', jsonInit('POST', { ids })), researchSchema),
		changeNotes: async (ids, change) =>
			request(async () => fetch('/api/notes', jsonInit('PATCH', { ids, ...change })), changeSchema),
	}
}
