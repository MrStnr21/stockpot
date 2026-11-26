// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

/*
 * What the research job and the deeper job share when they call an engine and settle the outcome.
 * Neither reads the other, so the helpers live here.
 */
import type * as v from 'valibot'

import { EngineError, type CardInput, type ResearchProgress } from '#/server/engines/contract'
import type { CardResult, Router } from '#/server/engines/router'
import type { JobContext } from '#/server/jobs/types'
import { log } from '#/server/log'

/** A note whose card the owner asked for is saved and readable. */
export interface ReadyNote {
	readonly noteId: number
	/** How many pages an idea's research read, when its engine reported progress. */
	readonly pagesRead?: number
}

// A reset that has already passed, or passes in a moment, still waits this long before the next call.
const shortestWaitMs = 60_000

/** When a job that waits for an engine's reset runs again: at the reset, but never within a minute. */
export function runAtAfterReset(reset: Date, now: Date): Date {
	return new Date(Math.max(reset.getTime(), now.getTime() + shortestWaitMs))
}

/** What a job hands the router: the category's engine routing and the redacted input. */
export interface CardCall<TSchema extends v.GenericSchema> {
	readonly categoryId: number
	readonly input: CardInput<'explain', TSchema> | CardInput<'research', TSchema>
	/** Called as a research task advances; an explain task is never given one. */
	readonly onProgress?: (progress: ResearchProgress) => void
}

export async function callRouter<TSchema extends v.GenericSchema>(
	router: Pick<Router, 'explain' | 'research'>,
	{ categoryId, input, onProgress }: CardCall<TSchema>,
	{ id, signal }: JobContext,
): Promise<CardResult<v.InferOutput<TSchema>>> {
	signal.throwIfAborted()
	const options = { categoryId, signal, jobId: id, onProgress }

	const call =
		input.task === 'research' ? router.research(input, options) : router.explain(input, options)

	/* The signal may have aborted inside the router call. The engine can still reject its promise
	 * after this attempt has given up on it. */
	call.catch(() => null)
	signal.throwIfAborted()
	const { promise: aborted, reject } = Promise.withResolvers<never>()

	function abort() {
		reject(signal.reason)
	}

	signal.addEventListener('abort', abort, { once: true })

	try {
		return await Promise.race([call, aborted])
	} finally {
		signal.removeEventListener('abort', abort)
	}
}

function logNotifyFailure({ noteId }: ReadyNote, error: Error) {
	log.warn('Notifying that a card is ready failed', { noteId, name: error.name })
}

/*
 * The card is saved, and a missed notification must not fail the job or retry it. A rejection that
 * nothing handles would end the process, so an async sender is caught too. A synchronous throw is
 * caught before the first await, so it is logged before the job returns.
 */
export function notifyReady(
	notify: (ready: ReadyNote) => void | Promise<void>,
	ready: ReadyNote,
): void {
	async function send() {
		try {
			await notify(ready)
		} catch (error) {
			logNotifyFailure(ready, error instanceof Error ? error : new Error('unknown'))
		}
	}

	// Never rejects: `send` logs every failure itself.
	send().catch(() => null)
}

/** The error a job rethrows: the runner stores its message, and a provider may echo the note in its own. */
export function publicEngineError(error: EngineError): EngineError {
	return new EngineError(error.failure, `The engine failed: ${error.kind}`, { cause: error })
}
