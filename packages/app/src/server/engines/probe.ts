// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

/*
 * The engine test behind the settings "Test" button: one suggestion call on a fixed note, through the
 * process's own engine, so the call is recorded in `engine_runs` and counts against Gemini's limits
 * like any other. The input carries no owner data. The answer is reduced to an outcome, because an
 * engine's error message may quote the provider, its URL or what it was sent.
 */
import { log } from '#/server/log'

import { EngineError, redactPrivate, type EngineErrorKind, type EngineFailure } from './contract'
import type { EngineSet, RouterSettings } from './router'
import { configuredEngines, type EngineId } from './settings'
import { suggestionFormat } from './suggestion'

/** The agent command spawns a process for the call, so the suggestion timeout of 3 s is too short. */
export const engineTestTimeoutMs = 15_000

/*
 * A test of an engine may start this long after its previous test started: with one test at a time,
 * that bounds a paid engine to 6 one-request calls a minute, however often the button is pressed.
 */
export const engineTestCooldownMs = 10_000

const testCategoryId = '1'

/* A public term and one made-up category: nothing from the owner's notes or categories. The agent
 * command's e2e stand-in answers a prompt that lists a category named Technology. */
const testInput = redactPrivate({
	task: 'suggest',
	note: { term: 'TypeScript', text: null, context: null, url: null, isPrivate: false },
	categories: [{ id: testCategoryId, name: 'Technology', hint: null }],
	language: 'en',
	output: suggestionFormat([testCategoryId]),
})

export type EngineTestOutcome = 'ok' | EngineErrorKind | 'error'

interface TestedAt {
	readonly engine: EngineId
	/** When the test started, as an ISO timestamp. */
	readonly testedAt: string
}

/** What a finished test tells a client: never an error message, a provider body, a URL or a key. */
export type EngineTestResult = TestedAt &
	(
		| { readonly outcome: 'ok'; readonly elapsedMs: number; readonly model: string | null }
		| { readonly outcome: 'rate_limited'; readonly resetsAt: string }
		| { readonly outcome: 'auth' | 'timeout' | 'invalid' | 'error' }
	)

export type EngineTestAnswer =
	| { readonly status: 'done'; readonly result: EngineTestResult }
	| { readonly status: 'not_set_up' }
	| { readonly status: 'running' }
	| { readonly status: 'too_soon'; readonly retryAfterMs: number }

export interface EngineTesterOptions {
	/** The process's engines, shared with the router. */
	readonly engines: EngineSet
	readonly settings: () => RouterSettings
	readonly agentCommand: string | null
	readonly now?: () => Date
	readonly cooldownMs?: number
}

export interface EngineTester {
	readonly test: (id: EngineId) => Promise<EngineTestAnswer>
}

/** A failure an engine recognised, or `null` for anything else it threw. */
function failedResult(tested: TestedAt, failure: EngineFailure | null): EngineTestResult {
	if (failure === null) {
		return { ...tested, outcome: 'error' }
	}

	return failure.kind === 'rate_limited'
		? { ...tested, outcome: 'rate_limited', resetsAt: failure.resetsAt.toISOString() }
		: { ...tested, outcome: failure.kind }
}

/**
 * One tester per process: it allows one running test per engine and a new start only
 * `cooldownMs` after the previous one started. The call takes no abort signal, so a client that
 * goes away cannot leave the guard held.
 */
export function createEngineTester({
	engines,
	settings,
	agentCommand,
	now = () => new Date(),
	cooldownMs = engineTestCooldownMs,
}: EngineTesterOptions): EngineTester {
	const running = new Set<EngineId>()
	const lastStarts = new Map<EngineId, number>()

	async function run(id: EngineId, tested: TestedAt): Promise<EngineTestResult> {
		const engine = engines[id]

		if (engine === null) {
			throw new Error(`The ${id} engine is configured but was not built`)
		}

		const { elapsedMs, model } = await engine.suggest(testInput, {
			tier: 'fast',
			timeoutMs: engineTestTimeoutMs,
		})

		return { ...tested, outcome: 'ok', elapsedMs, model }
	}

	return {
		async test(id) {
			if (!configuredEngines(settings().engines, agentCommand).includes(id)) {
				return { status: 'not_set_up' }
			}

			if (running.has(id)) {
				return { status: 'running' }
			}

			const startedAt = now()
			const sinceLast = startedAt.getTime() - (lastStarts.get(id) ?? Number.NEGATIVE_INFINITY)

			if (sinceLast < cooldownMs) {
				return { status: 'too_soon', retryAfterMs: cooldownMs - sinceLast }
			}

			running.add(id)
			lastStarts.set(id, startedAt.getTime())

			const tested = { engine: id, testedAt: startedAt.toISOString() }

			try {
				return { status: 'done', result: await run(id, tested) }
			} catch (error) {
				const result = failedResult(tested, error instanceof EngineError ? error.failure : null)

				// The name only: the message may quote the provider or what the call sent.
				log.warn('Engine test failed', {
					engine: id,
					outcome: result.outcome,
					error: error instanceof Error ? error.name : 'unknown',
				})

				return { status: 'done', result }
			} finally {
				running.delete(id)
			}
		},
	}
}
