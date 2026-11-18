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
} from './queue'
import { planDailyRun, toPlan, type Plan } from './schedules'
import type { JobDefinition, Runner, RunnerOptions } from './types'

/** The runner's state, shared by the functions below. */
interface Worker {
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

function planSchedules(worker: Worker) {
	const now = new Date()
	const timeZone = worker.timeZone()

	for (const plan of worker.plans.values()) {
		planDailyRun(worker.db, plan, { timeZone, now })
	}

	planWake(worker)
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
export function createRunner({
	db,
	jobs = [],
	schedules = [],
	timeZone = () => Temporal.Now.timeZoneId(),
}: RunnerOptions): Runner {
	const worker: Worker = {
		db,
		handlers: registerJobs([...jobs, ...schedules.map((schedule) => schedule.job)]),
		plans: new Map(schedules.map((schedule) => [schedule.job.kind, toPlan(schedule)])),
		timeZone,
		running: false,
		stopping: new AbortController(),
	}

	return {
		enqueue(job, payload, { priority = 'batch', runAt = new Date() } = {}) {
			if (worker.handlers.get(job.kind) !== job) {
				throw new Error(`The job kind "${job.kind}" is not registered with the runner`)
			}

			if (worker.plans.has(job.kind)) {
				throw new Error(`The job kind "${job.kind}" is queued by its schedule`)
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
			planSchedules(worker)
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

		refreshSchedules() {
			planSchedules(worker)
		},
	}
}

/** The runner this process started, if any (D2: one per process). */
interface ProcessRunner {
	runner?: Runner
}

const thisProcess: ProcessRunner = {}

/** Starts the one runner of this process. Nothing calls it yet: the README says why. */
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
