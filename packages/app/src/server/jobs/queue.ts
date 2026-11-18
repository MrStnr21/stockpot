// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { and, asc, desc, eq, inArray, lte, min, sql } from 'drizzle-orm'

import type { Db } from '#/server/db/client'
import { jobs } from '#/server/db/schema/jobs'

/** Job priorities: a "now" job, such as research the owner asked for, overtakes the nightly batch. */
export const priorities = { batch: 0, now: 10 } as const

export type Priority = keyof typeof priorities

export type JobRow = typeof jobs.$inferSelect

export interface NewJob {
	kind: string
	payload: unknown
	priority: Priority
	runAt: Date
}

const interrupted = 'Interrupted: the server stopped while the job was running'

/** Queues a job and returns its id. */
export function insertJob(db: Db, { kind, payload, priority, runAt }: NewJob): number {
	return db
		.insert(jobs)
		.values({ kind, payload, priority: priorities[priority], runAt })
		.returning({ id: jobs.id })
		.get().id
}

/**
 * The next due job: queued, highest priority first, then the earliest run time, then the oldest row.
 * `jobs_queue_idx` serves both the filter and the order, so no sort runs; a spec checks the plan.
 */
// oxlint-disable-next-line typescript/explicit-module-boundary-types -- The Drizzle query type is long; the spec reads its SQL.
export function nextDueJob(db: Db, now: Date) {
	return db
		.select({ id: jobs.id })
		.from(jobs)
		.where(and(eq(jobs.status, 'queued'), lte(jobs.runAt, now)))
		.orderBy(desc(jobs.priority), asc(jobs.runAt), asc(jobs.id))
		.limit(1)
}

/** Marks the next due job as running and counts the attempt, in one statement. */
export function claimNextJob(db: Db, now: Date): JobRow | undefined {
	return db
		.update(jobs)
		.set({ status: 'running', attempts: sql`${jobs.attempts} + 1`, startedAt: now })
		.where(inArray(jobs.id, nextDueJob(db, now)))
		.returning()
		.get()
}

/** The earliest run time among queued jobs, due or not, for the worker's next wake-up. */
export function nextRunAt(db: Db): Date | undefined {
	return (
		db
			.select({ runAt: min(jobs.runAt) })
			.from(jobs)
			.where(eq(jobs.status, 'queued'))
			.get()?.runAt ?? undefined
	)
}

export function finishJob(db: Db, id: number, now: Date): void {
	db.update(jobs).set({ status: 'done', finishedAt: now }).where(eq(jobs.id, id)).run()
}

export function retryJob(
	db: Db,
	{ id, error, runAt }: { id: number; error: string; runAt: Date },
): void {
	db.update(jobs)
		.set({ status: 'queued', runAt, lastError: error, startedAt: null })
		.where(eq(jobs.id, id))
		.run()
}

export function failJob(
	db: Db,
	{ id, error, now }: { id: number; error: string; now: Date },
): void {
	db.update(jobs)
		.set({ status: 'failed', lastError: error, finishedAt: now })
		.where(eq(jobs.id, id))
		.run()
}

/**
 * Puts jobs that were running when the process stopped back in the queue. Their attempt stays
 * counted, so a job that crashes the process every time still runs out of attempts.
 */
export function requeueInterrupted(db: Db): void {
	db.update(jobs)
		.set({ status: 'queued', lastError: interrupted, startedAt: null })
		.where(eq(jobs.status, 'running'))
		.run()
}
