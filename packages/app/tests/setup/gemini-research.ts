// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { jest } from 'bun:test'
import { cardInputFactory } from '#tests/factories/engine-input'
import explainFacts from '#tests/recordings/gemini/explain-facts.json'
import * as v from 'valibot'

import { cardFormat } from '#/features/research/shared/formats'
import { engineRuns } from '#/server/db/schema/jobs'
import type { CardInput, Engine } from '#/server/engines/contract'
import { createGeminiEngine } from '#/server/engines/gemini'
import type { UsageCounters, UsageLimit } from '#/server/engines/gemini-usage'
import { defaultEngines } from '#/server/engines/settings'

import { createTestDb } from './db'
import {
	arriving,
	fakeGeminiFetch,
	hang,
	recorded,
	suggestionSaying,
	type Answer,
	type SentRequest,
} from './gemini'

/** A first-level idea report input; the format is spread over the factory's, not merged with it. */
export function ideaInput(): CardInput<'research'> {
	return {
		...cardInputFactory.build(),
		task: 'research',
		depth: 1,
		previous: [],
		output: cardFormat('report', 1),
	}
}

/** The plan step's answer. */
export function planSaying(questions: readonly string[]): Answer {
	return suggestionSaying(JSON.stringify({ questions }))
}

/** What a search step found: the notes, the queries it ran, the pages it read and its entry point. */
export interface Found {
	readonly queries?: number
	readonly pages?: readonly string[]
	readonly suggestions?: string
}

/** The recorded grounded answer with its notes, queries, pages and Search Suggestions replaced. */
export function groundedSaying(
	notes: string,
	{ queries = 1, pages = [], suggestions = '<style></style>' }: Found = {},
): Answer {
	const [candidate] = explainFacts.body.candidates

	const groundingMetadata = {
		webSearchQueries: Array.from({ length: queries }, (_, index) => `query ${index}`),
		searchEntryPoint: { renderedContent: suggestions },
		groundingChunks: pages.map((uri) => ({ web: { uri, title: new URL(uri).hostname } })),
	}

	const content = { ...candidate.content, parts: [{ text: notes }] }

	return recorded({
		status: 200,
		body: {
			...explainFacts.body,
			candidates: [{ ...candidate, content, groundingMetadata, urlContextMetadata: undefined }],
		},
	})
}

/** An answer that is blocked: it has no candidate, so the engine reads it as `invalid`. */
export const blocked = recorded({
	status: 200,
	body: { promptFeedback: { blockReason: 'SAFETY' } },
})

/** One request of a scripted call: how it answers, and how far to move the clock for it. */
export interface Step {
	readonly answer: Answer
	readonly advance: number
}

/** Answers at once. */
export function instant(answer: Answer): Step {
	return { answer, advance: 0 }
}

/** Answers after `ms` of fake time. */
export function after(ms: number, answer: Answer): Step {
	async function late(request: Request) {
		await new Promise<void>((resolve) => {
			setTimeout(resolve, ms)
		})

		return answer(request)
	}

	return { answer: late, advance: ms }
}

/** Never answers; the clock moves on `ms` for it, to the time something stops it. */
export function stuck(ms: number): Step {
	return { answer: hang, advance: ms }
}

export interface Script {
	readonly answers: Answer[]
	/** Settles when the request at that index arrives. */
	readonly arrivals: readonly Promise<null>[]
	readonly steps: readonly Step[]
}

export function script(...steps: Step[]): Script {
	const answers: Answer[] = []
	const arrivals: Promise<null>[] = []

	for (const { answer } of steps) {
		const one = arriving(answer)

		answers.push(one.answer)
		arrivals.push(one.arrived)
	}

	return { answers, arrivals, steps }
}

/**
 * Moves the fake clock the way the script says, request by request: it waits for each request to
 * arrive, so a step's timer exists before the clock moves past it.
 */
export async function play({ arrivals, steps }: Script): Promise<void> {
	for (const [index, { advance }] of steps.entries()) {
		// oxlint-disable-next-line no-await-in-loop -- Each request exists only once the one before it was answered.
		await arrivals[index]
		jest.advanceTimersByTime(advance)
	}
}

const sentPart = v.object({ text: v.string() })

const sentMessage = v.object({ parts: v.tuple([sentPart]) })

const sentPrompt = v.object({ contents: v.tuple([sentMessage]) })

/** The prompt a request carried. */
export function promptOf({ body }: SentRequest): string {
	const { contents } = v.parse(sentPrompt, body)
	const [{ parts }] = contents
	const [{ text }] = parts

	return text
}

/** The model a request went to, from its URL. */
export function modelOf({ url }: SentRequest): string | undefined {
	return /\/models\/(?<model>[^:]+):/u.exec(url)?.groups?.model
}

interface HarnessOptions {
	/** The deep tier's model; Gemini 3 and 2.5 take different thinking configs. */
	readonly model?: string
	readonly limit?: UsageLimit
	readonly counters?: UsageCounters
}

export interface GeminiHarness {
	readonly engine: Engine
	readonly sent: SentRequest[]
	/** The answers to give, in the order the requests arrive. */
	readonly answers: Answer[]
	readonly runs: () => (typeof engineRuns.$inferSelect)[]
}

/** A Gemini engine on the fake `fetch`: it answers from `answers` and records what it is sent. */
export async function geminiHarness({
	model = 'gemini-3.8-flash',
	limit = { perMinute: null, perDay: null },
	counters,
}: HarnessOptions = {}): Promise<GeminiHarness> {
	const sent: SentRequest[] = []
	const answers: Answer[] = []
	const { db } = await createTestDb()
	const { gemini } = defaultEngines()
	const models = { ...gemini.models, deep: model }

	const settings = {
		...gemini,
		apiKey: 'test-key-a',
		models,
		limits: { ...gemini.limits, deep: limit },
	}

	const fetch = fakeGeminiFetch(() => answers.shift(), sent)
	const engine = createGeminiEngine({ db, settings: () => settings, fetch, counters })

	return { engine, sent, answers, runs: () => db.select().from(engineRuns).all() }
}
