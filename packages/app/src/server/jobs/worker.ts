// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import type { Db } from '#/server/db/client'

import { claimNextJob, failJob, finishJob, nextRunAt, retryJob, type JobRow } from './queue'
import { planDailyRun, type Plan } from './schedules'
import type { JobDefinition } from './types'

/** A database error the worker hit, and how long it waits before it tries again. */
interface Failure {
	error: string
	at: Date
	delay: number
}

/** The runner's state, shared by the worker's functions and the runner. */
export interface Worker {
	db: Db
	handlers: Map<string, JobDefinition<never>>
	/** Each scheduled kind's plan. */
	plans: Map<string, Plan>
	timeZone: () => string
	running: boolean
	stopping: AbortController
	/** The one timer, set for the earliest queued run time. */
	timer?: ReturnType<typeof setTimeout>
	/** Set while the worker works through due jobs. */
	draining?: Promise<void>
	/** Set from a database error until the worker next gets through the queue. */
	failure?: Failure
}

const defaultMaxAttempts = 5

const firstRetryDelay = 30_000

const longestRetryDelay = 3_600_000

const firstFailureDelay = 30_000

const longestFailureDelay = 300_000

// A timer fires at once when its delay does not fit a signed 32-bit integer (about 24.8 days).
const longestTimer = 2 ** 31 - 1

/** How long to wait before running a job again after its nth failed attempt: 30 s, doubling, at most an hour. */
export function retryDelay(attempt: number): number {
	return Math.min(firstRetryDelay * 2 ** (attempt - 1), longestRetryDelay)
}

function failWithoutRunning(worker: Worker, job: JobRow, error: string) {
	failJob(worker.db, { id: job.id, error, now: new Date() })
}

async function execute(worker: Worker, job: JobRow) {
	const handler = worker.handlers.get(job.kind)

	if (handler === undefined) {
		failWithoutRunning(worker, job, `No handler is registered for the job kind "${job.kind}"`)

		return
	}

	const maxAttempts = handler.maxAttempts ?? defaultMaxAttempts

	// Only a run that restarts interrupted gets here: it ran out of attempts without failing.
	if (job.attempts > maxAttempts) {
		failWithoutRunning(worker, job, job.lastError ?? 'Out of attempts')

		return
	}

	const { signal } = worker.stopping

	try {
		// SAFETY: enqueue stored this payload for this kind, typed by the same definition.
		// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- See the SAFETY note above.
		await handler.run(job.payload as never, { id: job.id, attempt: job.attempts, signal })
	} catch (error) {
		// The row stays running, so the next start requeues it as it would after a crash.
		if (signal.aborted) {
			return
		}

		const message = error instanceof Error ? error.message : String(error)

		if (job.attempts >= maxAttempts) {
			failJob(worker.db, { id: job.id, error: message, now: new Date() })
		} else {
			const runAt = new Date(Date.now() + retryDelay(job.attempts))

			retryJob(worker.db, { id: job.id, error: message, runAt })
		}

		return
	}

	finishJob(worker.db, job.id, new Date())
}

function claim(worker: Worker) {
	const now = new Date()
	const job = worker.running ? claimNextJob(worker.db, now) : undefined
	const plan = job === undefined ? undefined : worker.plans.get(job.kind)

	// Plan the next day's run before this one starts, so a slow or crashing run cannot lose it.
	if (plan !== undefined) {
		planDailyRun(worker.db, plan, { timeZone: worker.timeZone(), now })
	}

	return job
}

async function drain(worker: Worker) {
	for (let job = claim(worker); job !== undefined; job = claim(worker)) {
		// oxlint-disable-next-line no-await-in-loop -- One worker runs one job at a time (D2).
		await execute(worker, job)
	}
}

/** Sets the one timer for the earliest queued job. While the worker drains, it plans when it is done. */
export function planWake(worker: Worker): void {
	clearTimeout(worker.timer)
	delete worker.timer

	if (!worker.running || worker.draining !== undefined || worker.failure !== undefined) {
		return
	}

	const runAt = nextRunAt(worker.db)

	if (runAt !== undefined) {
		const delay = Math.min(Math.max(runAt.getTime() - Date.now(), 0), longestTimer)

		worker.timer = setTimeout(() => {
			work(worker)
		}, delay)
	}
}

function work(worker: Worker) {
	delete worker.timer

	if (!worker.running || worker.draining !== undefined) {
		return
	}

	worker.draining = drainSafely(worker).finally(() => {
		delete worker.draining
		resume(worker)
	})
}

/*
 * A database error, such as a full disk or a read-only file, must not become a loop of failed claims:
 * the worker logs it, keeps it for the health check and wakes again only after a delay that starts at
 * 30 s and doubles up to 5 minutes. Getting through the queue without an error clears it.
 */
function recordFailure(worker: Worker, error: Error) {
	const delay =
		worker.failure === undefined
			? firstFailureDelay
			: Math.min(worker.failure.delay * 2, longestFailureDelay)

	const cause = error.cause instanceof Error ? ` (${error.cause.message})` : ''

	worker.failure = { error: `${error.message}${cause}`, at: new Date(), delay }
	// oxlint-disable-next-line no-console -- The server has no logger yet, and this error must not pass silently.
	console.error(`The job runner hit an error and tries again in ${delay / 1000} s:`, error)
}

async function drainSafely(worker: Worker) {
	try {
		await drain(worker)
		delete worker.failure
	} catch (error) {
		recordFailure(worker, error instanceof Error ? error : new Error(String(error)))
	}
}

function armAfterFailure(worker: Worker, failure: Failure) {
	worker.timer = setTimeout(() => {
		work(worker)
	}, failure.delay)
}

/** Plans the next wake-up once the worker has drained, after a delay when it hit an error. */
function resume(worker: Worker) {
	try {
		planWake(worker)
	} catch (error) {
		recordFailure(worker, error instanceof Error ? error : new Error(String(error)))
	}

	if (worker.running && worker.failure !== undefined) {
		armAfterFailure(worker, worker.failure)
	}
}

export function planSchedules(worker: Worker): void {
	const now = new Date()
	const timeZone = worker.timeZone()

	for (const plan of worker.plans.values()) {
		planDailyRun(worker.db, plan, { timeZone, now })
	}

	planWake(worker)
}
