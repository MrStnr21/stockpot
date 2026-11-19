// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import * as v from 'valibot'

import { dailyRunOn, latestDailyRun, nextDailyRun, parseTimeOfDay } from './daily'
import {
	insertJob,
	plannedRun,
	replanJob,
	type JobRow,
	type Priority,
	type Queryable,
} from './queue'
import type { DailySchedule } from './types'

/** A schedule as the runner keeps it, with its time of day parsed. */
export interface Plan {
	kind: string
	at: Temporal.PlainTime
	priority: Priority
}

export function toPlan({ job, at, priority = 'batch' }: DailySchedule): Plan {
	return { kind: job.kind, at: parseTimeOfDay(at), priority }
}

/** A scheduled run's payload, read back from its row. */
const scheduledRun = v.object({ day: v.string() })

/** The local date a scheduled run belongs to, or undefined for a row whose payload has none. */
function dayOf(job: JobRow) {
	const parsed = v.safeParse(scheduledRun, job.payload)

	return parsed.success ? parsed.output.day : undefined
}

/*
 * Keeps one planned run per schedule, so a run fires once a day across restarts. The planned run
 * keeps its day when the time zone or the time of day changes: it moves to that day's time in the new
 * zone or at the new time, and fires at once when that time has passed, so no day runs twice or is
 * skipped.
 */
export function planDailyRun(
	db: Queryable,
	{ kind, at, priority }: Plan,
	{ timeZone, now }: { timeZone: string; now: Date },
): void {
	const planned = plannedRun(db, kind)

	if (planned === undefined) {
		const run = nextDailyRun(now, at, timeZone)

		insertJob(db, { kind, payload: { day: run.day }, priority, runAt: run.runAt })

		return
	}

	const day = dayOf(planned)
	const run = day === undefined ? nextDailyRun(now, at, timeZone) : dailyRunOn(day, at, timeZone)

	if (run.runAt.getTime() !== planned.runAt.getTime()) {
		replanJob(db, { id: planned.id, runAt: run.runAt, payload: { day: run.day } })
	}
}

/*
 * Only the latest missed run fires. A first attempt claimed after a later day's time, because the
 * server was down or the queue was busy for more than a day, runs as that later day, and the next
 * run is planned after it, so the following day is not skipped either.
 */
export function catchUpDailyRun(
	db: Queryable,
	{ job, plan }: { job: JobRow; plan: Plan },
	{ timeZone, now }: { timeZone: string; now: Date },
): JobRow {
	const day = dayOf(job)
	const latest = latestDailyRun(now, plan.at, timeZone)

	if (job.attempts !== 1 || day === undefined || latest.day <= day) {
		return job
	}

	const payload = { day: latest.day }

	replanJob(db, { id: job.id, runAt: latest.runAt, payload })

	return { ...job, runAt: latest.runAt, payload }
}
