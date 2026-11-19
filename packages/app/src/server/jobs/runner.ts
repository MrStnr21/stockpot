// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { insertJob, requeueInterrupted } from './queue'
import { toPlan } from './schedules'
import type { JobDefinition, Runner, RunnerHealth, RunnerOptions } from './types'
import { planSchedules, planWake, type Worker } from './worker'

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

		health(): RunnerHealth {
			const { failure } = worker

			return failure === undefined
				? { status: 'healthy' }
				: { status: 'failing', lastError: failure.error, failedAt: failure.at }
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
