// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { drainMicrotasks } from 'bun:jsc'

import type {
	ChangeResult,
	CountRow,
	JsonFetch,
	NotesPage,
	ResearchResult,
} from '#/features/notes/shared/types'

/** The JSON bodies the notes routes answer with. */
export type NotesAnswer =
	| NotesPage
	| { readonly counts: readonly CountRow[] }
	| { readonly results: readonly (ResearchResult | ChangeResult)[] }
	| { readonly error: { readonly code: string; readonly message: string } }

/** One request the notes list sent, answered or failed when the spec says so. */
export interface NotesFetchCall {
	readonly url: string
	readonly method: string
	readonly body: unknown
	readonly signal: AbortSignal | null
	/** Answers with this JSON and lets every awaiting step run. */
	readonly answer: (body: NotesAnswer, status?: number) => void
	readonly respond: (response: Response) => void
	readonly fail: (error: Error) => void
}

/** A `fetch` that holds every request until the spec answers it, in any order. */
export class NotesFetch {
	public readonly calls: NotesFetchCall[] = []

	public readonly fetch: JsonFetch = async (url, init) => {
		const { promise, resolve, reject } = Promise.withResolvers<Response>()

		this.calls.push({
			url,
			method: init.method ?? 'GET',
			body: init.body === undefined ? null : JSON.parse(init.body),
			signal: init.signal ?? null,
			answer: (body, status = 200) => {
				resolve(Response.json(body, { status }))
				drainMicrotasks()
			},
			respond: (response) => {
				resolve(response)
				drainMicrotasks()
			},
			fail: (error) => {
				reject(error)
				drainMicrotasks()
			},
		})

		return promise
	}

	public call(index: number): NotesFetchCall {
		const found = this.calls.at(index)

		if (found === undefined) {
			throw new Error(`There is no request ${index}.`)
		}

		return found
	}

	/** The latest request to a path, such as `/api/notes/counts`. */
	public last(path: string): NotesFetchCall {
		const found = this.calls.findLast(({ url }) => url.split('?')[0] === path)

		if (found === undefined) {
			throw new Error(`No request was sent to ${path}.`)
		}

		return found
	}

	/** The requests to a path, oldest first. */
	public to(path: string): NotesFetchCall[] {
		return this.calls.filter(({ url }) => url.split('?')[0] === path)
	}
}
