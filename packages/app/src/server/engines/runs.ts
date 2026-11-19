// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

/*
 * What every concrete engine does around a call: one call at a time, and one `engine_runs` row per
 * call with its outcome, duration and whatever usage the provider reported.
 */
import type { Db } from '#/server/db/client'
import { engineRuns, type engineOutcomes } from '#/server/db/schema/jobs'
import { log } from '#/server/log'

import { EngineError, type EngineResult, type Task } from './contract'

/** What the provider told about a call. A call fills it in as soon as it knows, failure or not. */
export interface RunReport {
	model: string | null
	inputTokens: number | null
	outputTokens: number | null
	searches: number | null
	costUsd: number | null
	/** The Search Suggestions HTML a grounded call returned; it goes to the result, not the row. */
	searchSuggestions: string | null
}

export interface RunRecord {
	readonly db: Db
	readonly engine: string
	readonly task: Task
	readonly jobId: number | null
	/** The model the engine asked for, when it chooses one; the provider's report replaces it. */
	readonly model?: string | null
}

type Outcome = (typeof engineOutcomes)[number]

/**
 * Runs `call` and records it in `engine_runs`, whatever its outcome: an `EngineError` records its
 * kind, any other failure records `error` and is thrown on unchanged.
 */
export async function recordRun<TOutput>(
	{ db, engine, task, jobId, model = null }: RunRecord,
	call: (report: RunReport) => Promise<TOutput>,
): Promise<EngineResult<TOutput>> {
	const startedAt = new Date()

	const report: RunReport = {
		model,
		inputTokens: null,
		outputTokens: null,
		searches: null,
		costUsd: null,
		searchSuggestions: null,
	}

	let outcome: Outcome = 'error'

	try {
		const output = await call(report)

		outcome = 'ok'

		const { model: reported, searchSuggestions } = report

		return {
			output,
			engine,
			model: reported,
			searchSuggestions,
			elapsedMs: Date.now() - startedAt.getTime(),
		}
	} catch (error) {
		if (error instanceof EngineError) {
			outcome = error.kind
		}

		throw error
	} finally {
		const durationMs = Date.now() - startedAt.getTime()

		// The row is bookkeeping: a database error must not replace the call's own answer or error.
		try {
			const { inputTokens, outputTokens, searches, costUsd } = report
			const usage = { model: report.model, inputTokens, outputTokens, searches, costUsd }

			db.insert(engineRuns)
				.values({ ...usage, jobId, engine, task, outcome, startedAt, durationMs })
				.run()
		} catch (error) {
			log.error(`Could not record the ${engine} run`, {
				engine,
				error: error instanceof Error ? error : String(error),
			})
		}
	}
}

/** The reason a signal aborted with, as an error: the reason itself when it is one. */
export function abortReason(signal: AbortSignal): Error {
	const reason: unknown = signal.reason

	return reason instanceof Error ? reason : new Error('The call was aborted', { cause: reason })
}

/** Runs a call once every call before it has finished. */
export type Line = <T>(signal: AbortSignal | undefined, call: () => Promise<T>) => Promise<T>

async function turn(previous: Promise<void>, signal: AbortSignal | undefined): Promise<void> {
	if (signal === undefined) {
		return previous
	}

	const { promise: left, reject } = Promise.withResolvers<never>()

	function leave() {
		if (signal !== undefined) {
			reject(abortReason(signal))
		}
	}

	signal.addEventListener('abort', leave, { once: true })

	try {
		await Promise.race([previous, left])
	} finally {
		signal.removeEventListener('abort', leave)
	}
}

/**
 * One call at a time, in the order they arrive. A call whose signal aborts while it waits leaves the
 * line at once with the signal's reason and never runs; the calls behind it keep their order.
 */
export function oneAtATime(): Line {
	let last: Promise<void> = Promise.resolve()

	return async (signal, call) => {
		signal?.throwIfAborted()

		const previous = last
		const { promise: done, resolve: release } = Promise.withResolvers<null>()

		// The next call waits for this one and for everything before it, even if this one left early.
		last = previous.then(async () => {
			await done
		})

		try {
			await turn(previous, signal)

			return await call()
		} finally {
			release(null)
		}
	}
}
