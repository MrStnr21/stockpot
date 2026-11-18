// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import type { Db } from '#/server/db/client'

import { latestDailyRun, nextDailyRun, parseTimeOfDay } from './daily'
import { insertJob, plannedRun, replanJob, type Priority } from './queue'
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

/*
 * Keeps one planned run per schedule, so a run fires once a day across restarts. A run missed while
 * the server was down is not dropped: the latest missed run fires once on the next start, with that
 * run's day, and earlier missed days are skipped. A planned run that is not due yet moves when the
 * time zone or the time of day changed.
 */
export function planDailyRun(
	db: Db,
	{ kind, at, priority }: Plan,
	{ timeZone, now }: { timeZone: string; now: Date },
): void {
	const planned = plannedRun(db, kind)

	if (planned === undefined) {
		const run = nextDailyRun(now, at, timeZone)

		insertJob(db, { kind, payload: { day: run.day }, priority, runAt: run.runAt })

		return
	}

	const run =
		planned.runAt <= now ? latestDailyRun(now, at, timeZone) : nextDailyRun(now, at, timeZone)

	if (run.runAt.getTime() !== planned.runAt.getTime()) {
		replanJob(db, { id: planned.id, runAt: run.runAt, payload: { day: run.day } })
	}
}
