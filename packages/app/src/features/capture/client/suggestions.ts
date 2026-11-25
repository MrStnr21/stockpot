// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import * as v from 'valibot'

import type { JsonFetch, SuggestAnswer } from '../shared/types'
import { splitContext } from './split-context'

/** "After a half-second pause" in the DES-2 boards. */
export const suggestDebounceMs = 500

/* The server waits 1.2 s for the engine, then answers `pending`; asking again reads its cache. */
export const pendingRetryMs = 800

export const maxPendingRetries = 2

const id = v.pipe(v.number(), v.integer())

const noteStatus = v.picklist([
	'new',
	'queued',
	'researching',
	'ready',
	'read',
	'archived',
	'failed',
])

/* Every card body carries `sense`; a body without one reads as no sense rather than a bad answer. */
const cardSense = v.object({ sense: v.string() })

const cardBody = v.fallback(v.nullable(cardSense), null)

const lastCard = v.pipe(
	v.object({ noteId: v.nullable(id), body: cardBody }),
	v.transform(({ noteId, body }) => ({ noteId, sense: body?.sense ?? null })),
)

const historyMatch = v.object({
	term: v.string(),
	meaning: v.string(),
	categoryId: v.nullable(id),
	state: v.picklist(['saved', 'seen', 'known']),
	note: v.nullable(v.object({ id, status: noteStatus })),
	lastCard: v.nullable(lastCard),
})

const sense = v.object({ sense: v.string(), categoryId: id })

const answerSchema = v.object({
	history: v.array(historyMatch),
	categories: v.array(id),
	senses: v.array(sense),
	language: v.nullable(v.string()),
	source: v.picklist(['history', 'engine', 'none']),
	pending: v.boolean(),
}) satisfies v.GenericSchema<unknown, SuggestAnswer>

/** What the sheet shows when there is no suggestion: every category, none picked. */
export const emptyAnswer: SuggestAnswer = {
	history: [],
	categories: [],
	senses: [],
	language: null,
	source: 'none',
	pending: false,
}

export interface SuggestionInput {
	readonly text: string
	/** The "where you saw it" field as typed; it is split into `context` and `url` per request. */
	readonly contextField: string
	readonly private: boolean
}

export type SuggestionState =
	| { readonly kind: 'empty' }
	| { readonly kind: 'loading'; readonly text: string }
	| { readonly kind: 'ready'; readonly text: string; readonly answer: SuggestAnswer }

export interface SuggestionRunnerOptions {
	readonly fetch: JsonFetch
	/** The sheet's current fields, read when a request is sent. */
	readonly read: () => SuggestionInput
	readonly onChange: (state: SuggestionState) => void
	readonly isOnline?: () => boolean
}

export interface SuggestionRunner {
	/** The term changed: ask after a pause in typing. */
	schedule: () => void
	/** Ask at once, as when Private is toggled. */
	askNow: () => void
	/** The sheet closed: drop the timer and whatever is in flight. */
	stop: () => void
}

interface RequestBody {
	readonly text: string
	readonly context: string | null
	readonly url: string | null
	readonly private: boolean
}

async function readAnswer(response: Response) {
	if (!response.ok) {
		return null
	}

	const parsed = v.safeParse(answerSchema, await response.json().catch(() => null))

	return parsed.success ? parsed.output : null
}

/**
 * Runs `POST /api/suggest` for the capture sheet. Each request gets a sequence number and its own
 * `AbortController`; a newer request or a stop aborts it, and an answer whose number is no longer the
 * latest is dropped, since an abort can lose the race with a body that has already arrived.
 */
export function createSuggestionRunner({
	fetch,
	read,
	onChange,
	isOnline = () => navigator.onLine,
}: SuggestionRunnerOptions): SuggestionRunner {
	let sequence = 0
	let controller: AbortController | null = null
	let timer: ReturnType<typeof setTimeout> | null = null

	function cancel() {
		sequence += 1

		if (timer !== null) {
			clearTimeout(timer)
			timer = null
		}

		controller?.abort()
		controller = null

		return sequence
	}

	async function send(current: number, body: RequestBody, retries: number) {
		controller = new AbortController()

		const answer = await fetch('/api/suggest', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(body),
			signal: controller.signal,
		})
			.then(readAnswer)
			.catch(() => null)

		if (current !== sequence) {
			return
		}

		controller = null

		if (answer?.pending === true && retries < maxPendingRetries) {
			timer = setTimeout(() => {
				timer = null
				send(current, body, retries + 1).catch(() => null)
			}, pendingRetryMs)

			return
		}

		const shown = answer === null || answer.pending ? emptyFrom(answer) : answer

		onChange({ kind: 'ready', text: body.text, answer: shown })
	}

	function ask() {
		const current = cancel()
		const input = read()
		const text = input.text.trim()

		if (text === '') {
			onChange({ kind: 'empty' })

			return
		}

		if (!isOnline()) {
			onChange({ kind: 'ready', text, answer: emptyAnswer })

			return
		}

		onChange({ kind: 'loading', text })
		const body = { text, ...splitContext(input.contextField), private: input.private }

		send(current, body, 0).catch(() => null)
	}

	return {
		schedule() {
			const current = cancel()

			if (read().text.trim() === '') {
				onChange({ kind: 'empty' })

				return
			}

			timer = setTimeout(() => {
				timer = null

				if (current === sequence) {
					ask()
				}
			}, suggestDebounceMs)
		},
		askNow: ask,
		stop() {
			cancel()
		},
	}
}

/** An answer still pending after the retries keeps its history: that part never waits for the engine. */
function emptyFrom(answer: SuggestAnswer | null): SuggestAnswer {
	return answer === null ? emptyAnswer : { ...emptyAnswer, history: answer.history }
}
