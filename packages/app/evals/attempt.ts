// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

/*
 * One engine call of an eval run, timed whatever its outcome. A usage limit that resets within a
 * minute is waited out and the call made again; a longer limit or a rejected key stops the run, since
 * every call after it would fail the same way.
 */
import { EngineError, type EngineFailure } from '#/server/engines/contract'

export type Failure =
	| { readonly kind: 'invalid'; readonly issues: readonly string[] }
	| {
			readonly kind: 'error'
			readonly message: string
			/** The engine's own failure, when it reported one. */
			readonly engineFailure: EngineFailure | null
	  }

export type Attempt<T> =
	| { readonly answer: T; readonly failure: null; readonly elapsedMs: number }
	| { readonly answer: null; readonly failure: Failure; readonly elapsedMs: number }

export interface AttemptClock {
	/** Times the call, in milliseconds. */
	readonly now: () => number
	/** Waits out a usage limit. */
	readonly wait: (ms: number) => Promise<void>
}

/** A usage limit that resets within this long is waited out. */
export const maxWaitMs = 60_000

// A limit that keeps coming back after its reset stops the run rather than stalling it.
const maxRetries = 3

/** Runs one call and times it; the time spent waiting out a limit is not the call's. */
export async function attempt<T>(
	clock: AttemptClock,
	call: () => Promise<T>,
	retries = 0,
): Promise<Attempt<T>> {
	const startedAt = clock.now()

	try {
		const answer = await call()

		return { answer, failure: null, elapsedMs: clock.now() - startedAt }
	} catch (error) {
		const elapsedMs = clock.now() - startedAt

		if (!(error instanceof EngineError)) {
			const message = error instanceof Error ? error.message : String(error)

			return { answer: null, failure: { kind: 'error', message, engineFailure: null }, elapsedMs }
		}

		const { failure } = error

		if (failure.kind === 'invalid') {
			return { answer: null, failure: { kind: 'invalid', issues: failure.issues }, elapsedMs }
		}

		const waitMs =
			failure.kind === 'rate_limited' ? failure.resetsAt.getTime() - Date.now() : Number.NaN

		if (waitMs <= maxWaitMs && retries < maxRetries) {
			await clock.wait(Math.max(0, waitMs))

			return attempt(clock, call, retries + 1)
		}

		return {
			answer: null,
			failure: { kind: 'error', message: failure.kind, engineFailure: failure },
			elapsedMs,
		}
	}
}

/** Why a failure stops the run, or `null` when the run goes on. */
export function stopReason(failure: Failure | null): string | null {
	const engineFailure = failure?.kind === 'error' ? failure.engineFailure : null

	if (engineFailure?.kind === 'auth') {
		return 'the engine rejected its key or login (auth)'
	}

	if (engineFailure?.kind === 'rate_limited') {
		return `the engine's usage limit resets at ${engineFailure.resetsAt.toISOString()}, more than a minute away`
	}

	return null
}
