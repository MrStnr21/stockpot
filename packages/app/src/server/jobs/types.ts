// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import type { Db } from '#/server/db/client'

import type { Priority } from './queue'

/** What a handler gets besides its payload. */
export interface JobContext {
	id: number
	/** 1 on the first run; a run that a restart interrupted counts too. */
	attempt: number
	/**
	 * Aborted when the run times out, which counts as a failed attempt, or when the runner stops, after
	 * which the job runs again on the next start.
	 */
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
	/** Milliseconds a run may take before it counts as a failed attempt. Default 30 minutes: research runs up to 15. */
	timeout?: number
	/** The payload is stored as JSON, so it holds plain data: no dates, maps or class instances. */
	run: (payload: Payload, context: JobContext) => Promise<void>
}

/** The payload of a scheduled job: the local date its run belongs to, such as '2026-11-18'. */
export interface ScheduledRun {
	day: string
}

/** A job that runs once a day at a local time, in the configured time zone. */
export interface DailySchedule {
	/** Only the schedule queues this kind, so it has exactly one planned run. */
	job: JobDefinition<ScheduledRun>
	/** 'HH:MM', such as '07:00'. */
	at: string
	/** Default "batch". */
	priority?: Priority
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
	schedules?: readonly DailySchedule[]
	/**
	 * The IANA time zone schedules run in, read whenever a run is planned. Default: the system's.
	 * src/boot.ts passes the time zone setting.
	 */
	timeZone?: () => string
}

/** What the health check reports: healthy, or the last error the runner hit and when. */
export type RunnerHealth =
	{ status: 'healthy' } | { status: 'failing'; lastError: string; failedAt: Date }

export interface Runner {
	/** Queues a job and returns its id. Request handlers call this and return; they never wait for the job. */
	enqueue: <Payload>(
		job: JobDefinition<Payload>,
		payload: NoInfer<Payload>,
		options?: EnqueueOptions,
	) => number
	/** Requeues the jobs a stop interrupted, plans the schedules, then works through the queue. */
	start: () => void
	/** Takes no new job, aborts the one in hand and waits for its handler to return. */
	stop: () => Promise<void>
	/** Resolves when the worker has finished what it is doing; specs await it after moving the clock. */
	idle: () => Promise<void>
	/** Plans each schedule's next run again; call it after the time zone setting changes. */
	refreshSchedules: () => void
	/** The runner's own state, for the health check; a handler's errors stay on its job. */
	health: () => RunnerHealth
}
