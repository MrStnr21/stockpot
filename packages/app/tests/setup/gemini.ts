// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { suggestInputFactory } from '#tests/factories/engine-input'
import suggestAnswer from '#tests/recordings/gemini/suggest.json'

import {
	parseJsonText,
	redactPrivate,
	type JsonValue,
	type Redacted,
	type SuggestInput,
} from '#/server/engines/contract'
import { suggestionFormat } from '#/server/engines/suggestion'

/** A request the Gemini engine sent through the fake `fetch`. */
export interface SentRequest {
	readonly url: string
	readonly key: string | null
	readonly text: string
	readonly body: JsonValue
}

/** How the fake answers one request. */
export type Answer = (request: Request) => Promise<Response>

/** Answers with a response recorded by `tests/recordings/gemini.ts`. */
export function recorded({
	status,
	body,
}: {
	readonly status: number
	readonly body: object
}): Answer {
	return async () => Response.json(body, { status })
}

/** The recorded suggestion with its answer text replaced. */
export function suggestionSaying(text: string, finishReason = 'STOP'): Answer {
	const [candidate] = suggestAnswer.body.candidates
	const content = { ...candidate.content, parts: [{ text }] }

	return recorded({
		status: 200,
		body: { ...suggestAnswer.body, candidates: [{ ...candidate, content, finishReason }] },
	})
}

/** Never answers, and fails the request with the reason it was aborted. */
export async function hang(request: Request): Promise<Response> {
	const { promise, reject } = Promise.withResolvers<Response>()

	request.signal.addEventListener('abort', () => {
		reject(request.signal.reason)
	})

	return promise
}

/** A `fetch` for the engine's SDK that records each request in `sent` and answers with `next()`. */
export function fakeGeminiFetch(next: () => Answer | undefined, sent: SentRequest[]): typeof fetch {
	async function fakeFetch(input: RequestInfo | URL, init?: RequestInit) {
		const request = new Request(input, init)
		const text = await request.clone().text()
		const key = request.headers.get('x-goog-api-key')

		sent.push({ url: request.url, key, text, body: parseJsonText(text) })

		return (next() ?? recorded({ status: 500, body: {} }))(request)
	}

	return Object.assign(fakeFetch, { preconnect: fetch.preconnect })
}

const recordedCategories = [
	{ id: 'technology', name: 'Technology', hint: null },
	{ id: 'english', name: 'English', hint: 'Words and phrases to learn' },
	{ id: 'concept', name: 'Concept', hint: null },
]

/**
 * A suggestion input with the categories the recorded suggestion chose from. They are spread over
 * the factory's rather than passed to `build`, which would merge the two schemas.
 */
export function recordedSuggestInput(): Redacted<SuggestInput> {
	return redactPrivate({
		...suggestInputFactory.build(),
		categories: recordedCategories,
		output: suggestionFormat(recordedCategories.map(({ id }) => id)),
	})
}
