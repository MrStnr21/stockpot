// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import type { Db } from '#/server/db/client'

import {
	claimNextJob,
	failJob,
	finishJob,
	insertJob,
	nextRunAt,
	requeueInterrupted,
	retryJob,
	type JobRow,
	type Priority,
} from './queue'

/** What a handler gets besides its payload. */
export interface JobContext {
	id: number
	/** 1 on the first run; a run that a restart interrupted counts too. */
	attempt: number
	/** Aborted when the runner stops. A run that ends early because of it starts again on the next start. */
	signal: AbortSignal
}

/**
 * A kind of job and its handler. A feature defines it and the server entry passes it to the runner
 * at startup, because `server/` never imports a feature.
 */
export interface JobDefinition<Payload> {
	/** Stored in each row: renaming a kind strands the rows already queued under the old name. */
	kind: string
	/** Runs before the job is marked failed, the first one included. Default 5. */
	maxAttempts?: number
	/** The payload is stored as JSON, so it holds plain data: no dates, maps or class instances. */
	run: (payload: Payload, context: JobContext) => Promise<void>
}

export interface EnqueueOptions {
	/** Default "batch". */
	priority?: Priority
	/** When the job becomes due. Default now. */
	runAt?: Date
}

export interface RunnerOptions {
	db: Db
	jobs?: readonly JobDefinition<never>[]
}

export interface Runner {
	/** Queues a job and returns its id. Request handlers call this and return; they never wait for the job. */
	enqueue: <Payload>(
		job: JobDefinition<Payload>,
		payload: NoInfer<Payload>,
		options?: EnqueueOptions,
	) => number
	/** Requeues the jobs a stop interrupted, then works through the queue. */
	start: () => void
	/** Takes no new job, aborts the one in hand and waits for its handler to return. */
	stop: () => Promise<void>
	/** Resolves when the worker has finished what it is doing; specs await it after moving the clock. */
	idle: () => Promise<void>
}

/** The runner's state, shared by the functions below. */
interface Worker {
	db: Db
	handlers: Map<string, JobDefinition<never>>
	running: boolean
	stopping: AbortController
	/** The one timer, set for the earliest queued run time. */
	timer?: ReturnType<typeof setTimeout>
	/** Set while the worker works through due jobs. */
	draining?: Promise<void>
}

const defaultMaxAttempts = 5

const firstRetryDelay = 30_000

const longestRetryDelay = 3_600_000

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
	return worker.running ? claimNextJob(worker.db, new Date()) : undefined
}

async function drain(worker: Worker) {
	for (let job = claim(worker); job !== undefined; job = claim(worker)) {
		// oxlint-disable-next-line no-await-in-loop -- One worker runs one job at a time (D2).
		await execute(worker, job)
	}
}

/** Sets the one timer for the earliest queued job. While the worker drains, it plans when it is done. */
function planWake(worker: Worker) {
	clearTimeout(worker.timer)
	delete worker.timer

	if (!worker.running || worker.draining !== undefined) {
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

	worker.draining = drain(worker).finally(() => {
		delete worker.draining
		planWake(worker)
	})
}

function registerJobs(jobs: readonly JobDefinition<never>[]) {
	const handlers = new Map<string, JobDefinition<never>>()

	for (const job of jobs) {
		if (handlers.has(job.kind)) {
			throw new Error(`The job kind "${job.kind}" is registered twice`)
		}

		handlers.set(job.kind, job)
	}

	return handlers
}

/**
 * The job runner (D2): one worker in the server process takes the next due job in priority order.
 * It sleeps on one timer set for the earliest queued run time and wakes when a job is enqueued, so
 * it never polls.
 */
export function createRunner({ db, jobs = [] }: RunnerOptions): Runner {
	const worker: Worker = {
		db,
		handlers: registerJobs(jobs),
		running: false,
		stopping: new AbortController(),
	}

	return {
		enqueue(job, payload, { priority = 'batch', runAt = new Date() } = {}) {
			if (worker.handlers.get(job.kind) !== job) {
				throw new Error(`The job kind "${job.kind}" is not registered with the runner`)
			}

			const id = insertJob(db, { kind: job.kind, payload, priority, runAt })

			planWake(worker)

			return id
		},

		start() {
			if (worker.running) {
				return
			}

			worker.running = true
			worker.stopping = new AbortController()
			requeueInterrupted(db)
			planWake(worker)
		},

		async stop() {
			worker.running = false
			clearTimeout(worker.timer)
			delete worker.timer
			worker.stopping.abort()
			await worker.draining
		},

		async idle() {
			await worker.draining
		},
	}
}

/** The runner this process started, if any (D2: one per process). */
interface ProcessRunner {
	runner?: Runner
}

const thisProcess: ProcessRunner = {}

/** Starts the one runner of this process; the entry that starts the server calls it. */
export function startRunner(options: RunnerOptions): Runner {
	if (thisProcess.runner !== undefined) {
		throw new Error('The job runner has already started')
	}

	thisProcess.runner = createRunner(options)
	thisProcess.runner.start()

	return thisProcess.runner
}

/** Stops the runner on shutdown and waits for the job in hand. */
export async function stopRunner(): Promise<void> {
	const { runner } = thisProcess

	delete thisProcess.runner
	await runner?.stop()
}
