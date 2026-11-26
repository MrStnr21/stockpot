// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

/*
 * The opened card's requests over an injected `fetch`. Every answer is parsed before the card reads
 * it; anything that does not parse counts as a failure, like a network error.
 */
import * as v from 'valibot'

import { cardViewSchema, type CardView } from '../shared/card-view'

/** A `fetch` that takes a JSON body as a string. */
export type JsonFetch = (
	url: string,
	init: RequestInit & { readonly body?: string },
) => Promise<Response>

/**
 * How a request ended: its parsed answer, or why there is none. `missing` is a 404 (no such note, or
 * deleted), `conflict` a 409 (the note changed meanwhile), `unavailable` a 503 without a job runner.
 */
export type CardResult<T> =
	| { readonly kind: 'ok'; readonly value: T }
	| { readonly kind: 'unauthorized' }
	| { readonly kind: 'missing' }
	| { readonly kind: 'conflict' }
	| { readonly kind: 'unavailable' }
	| { readonly kind: 'failed' }

/** The changes the card sends to `PATCH /api/notes/:id`. */
export interface NoteChange {
	readonly status?: 'read' | 'archived'
	readonly kept?: boolean
	readonly categoryId?: number | null
	readonly deleted?: false
}

const deeperSchema = v.object({
	outcome: v.picklist(['queued', 'pending', 'deepest']),
	depth: v.nullable(v.picklist([2, 3])),
})

export type DeeperAnswer = v.InferOutput<typeof deeperSchema>

const researchSchema = v.object({ outcome: v.picklist(['queued', 'pending', 'done']) })

export type ResearchAnswer = v.InferOutput<typeof researchSchema>

// The answers whose body the card does not read: it fetches the card again instead.
const ignored = v.pipe(
	v.unknown(),
	v.transform(() => null),
)

// Only a 503 that says so means the job runner is missing; any other 503 is a plain failure.
const jobsUnavailable = v.object({ error: v.object({ code: v.literal('jobs_unavailable') }) })

export interface CardApi {
	card: (id: number, signal: AbortSignal) => Promise<CardResult<CardView>>
	change: (id: number, change: NoteChange) => Promise<CardResult<null>>
	remove: (id: number) => Promise<CardResult<null>>
	deeper: (id: number, now: boolean) => Promise<CardResult<DeeperAnswer>>
	research: (id: number) => Promise<CardResult<ResearchAnswer>>
}

const statusKinds = new Map<number, CardResult<never>>([
	[401, { kind: 'unauthorized' }],
	[404, { kind: 'missing' }],
	[409, { kind: 'conflict' }],
])

async function failure(response: Response): Promise<CardResult<never>> {
	if (response.status !== 503) {
		return statusKinds.get(response.status) ?? { kind: 'failed' }
	}

	const body: unknown = await response.json()

	return v.is(jobsUnavailable, body) ? { kind: 'unavailable' } : { kind: 'failed' }
}

async function request<T>(
	send: () => Promise<Response>,
	schema: v.GenericSchema<unknown, T>,
): Promise<CardResult<T>> {
	try {
		const response = await send()

		if (!response.ok) {
			return await failure(response)
		}

		const body: unknown = response.status === 204 ? null : await response.json()
		const parsed = v.safeParse(schema, body)

		return parsed.success ? { kind: 'ok', value: parsed.output } : { kind: 'failed' }
	} catch {
		return { kind: 'failed' }
	}
}

function json(
	method: 'PATCH' | 'POST',
	body: NoteChange | { readonly now?: true },
): RequestInit & { readonly body: string } {
	return { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
}

function note(id: number) {
	return `/api/notes/${id}`
}

export function createCardApi({ fetch }: { readonly fetch: JsonFetch }): CardApi {
	return {
		card: async (id, signal) =>
			request(async () => fetch(`${note(id)}/card`, { signal }), cardViewSchema),
		change: async (id, change) =>
			request(async () => fetch(note(id), json('PATCH', change)), ignored),
		remove: async (id) => request(async () => fetch(note(id), { method: 'DELETE' }), ignored),
		deeper: async (id, now) =>
			request(
				async () => fetch(`${note(id)}/deeper`, json('POST', now ? { now } : {})),
				deeperSchema,
			),
		research: async (id) =>
			request(async () => fetch(`${note(id)}/research`, json('POST', {})), researchSchema),
	}
}
