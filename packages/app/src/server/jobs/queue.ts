// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { and, asc, desc, eq, inArray, lte, min, sql, type SQLWrapper } from 'drizzle-orm'

import type { Db } from '#/server/db/client'
import { jobs, type JobStatus } from '#/server/db/schema/jobs'

/** Job priorities: a "now" job, such as research the owner asked for, overtakes the nightly batch. */
export const priorities = { batch: 0, now: 10 } as const

export type Priority = keyof typeof priorities

export type JobRow = typeof jobs.$inferSelect

/** The database or a transaction on it: the queries below run in either. */
export type Queryable = Pick<Db, 'insert' | 'select' | 'update'>

export interface NewJob {
	kind: string
	payload: unknown
	priority: Priority
	runAt: Date
}

const interrupted = 'Interrupted: the server stopped while the job was running'

/** Queues a job and returns its id. */
export function insertJob(db: Queryable, { kind, payload, priority, runAt }: NewJob): number {
	return db
		.insert(jobs)
		.values({ kind, payload, priority: priorities[priority], runAt })
		.returning({ id: jobs.id })
		.get().id
}

export function activeJobPayloads(db: Queryable, kind: string): unknown[] {
	return db
		.select({ payload: jobs.payload })
		.from(jobs)
		.where(and(eq(jobs.kind, kind), inArray(jobs.status, ['queued', 'running'])))
		.all()
		.map(({ payload }) => payload)
}

const jobSummary = {
	id: jobs.id,
	kind: jobs.kind,
	payload: jobs.payload,
	priority: jobs.priority,
	status: jobs.status,
	runAt: jobs.runAt,
	createdAt: jobs.createdAt,
	attempts: jobs.attempts,
	lastError: jobs.lastError,
	finishedAt: jobs.finishedAt,
}

/** What `jobsOfKinds` and `newestJobForNote` read of a job: everything but its run's start time. */
export type JobSummary = Omit<JobRow, 'startedAt' | 'updatedAt'>

/**
 * The jobs of these kinds in these statuses, in no particular order. The status filter comes first,
 * so `jobs_queue_idx` finds the rows; a spec checks the plan.
 */
// oxlint-disable-next-line typescript/explicit-module-boundary-types -- The Drizzle query type is long; jobsOfKinds runs it.
export function selectJobsOfKinds(
	db: Queryable,
	kinds: readonly string[],
	statuses: readonly JobStatus[],
) {
	return db
		.select(jobSummary)
		.from(jobs)
		.where(and(inArray(jobs.status, [...statuses]), inArray(jobs.kind, [...kinds])))
}

export function jobsOfKinds(
	db: Queryable,
	kinds: readonly string[],
	statuses: readonly JobStatus[],
): JobSummary[] {
	if (kinds.length === 0 || statuses.length === 0) {
		return []
	}

	return selectJobsOfKinds(db, kinds, statuses).all()
}

/**
 * The newest job of a kind whose payload names this note, in any status. It reads the table
 * backwards by id and stops at the first match, so the note's latest job is found without reading
 * older rows; a spec checks the plan.
 */
// oxlint-disable-next-line typescript/explicit-module-boundary-types -- The Drizzle query type is long; newestJobForNote runs it.
export function selectNewestJobForNote(db: Queryable, kind: string, noteId: number) {
	return db
		.select(jobSummary)
		.from(jobs)
		.where(and(eq(jobs.kind, kind), eq(sql`json_extract(${jobs.payload}, '$.noteId')`, noteId)))
		.orderBy(desc(jobs.id))
		.limit(1)
}

export function newestJobForNote(
	db: Queryable,
	kind: string,
	noteId: number,
): JobSummary | undefined {
	return selectNewestJobForNote(db, kind, noteId).get()
}

/**
 * The next due job: queued, highest priority first, then the earliest run time, then the oldest row.
 * `jobs_queue_idx` serves both the filter and the order, so no sort runs; a spec checks the plan.
 */
export function nextDueJob(db: Queryable, now: Date): SQLWrapper {
	return db
		.select({ id: jobs.id })
		.from(jobs)
		.where(and(eq(jobs.status, 'queued'), lte(jobs.runAt, now)))
		.orderBy(desc(jobs.priority), asc(jobs.runAt), asc(jobs.id))
		.limit(1)
}

/** Marks the next due job as running and counts the attempt, in one statement. */
export function claimNextJob(db: Queryable, now: Date): JobRow | undefined {
	return db
		.update(jobs)
		.set({ status: 'running', attempts: sql`${jobs.attempts} + 1`, startedAt: now })
		.where(inArray(jobs.id, nextDueJob(db, now)))
		.returning()
		.get()
}

/** The earliest run time among queued jobs, due or not, for the worker's next wake-up. */
export function nextRunAt(db: Queryable): Date | undefined {
	return (
		db
			.select({ runAt: min(jobs.runAt) })
			.from(jobs)
			.where(eq(jobs.status, 'queued'))
			.get()?.runAt ?? undefined
	)
}

export function finishJob(db: Queryable, id: number, now: Date): void {
	db.update(jobs).set({ status: 'done', finishedAt: now }).where(eq(jobs.id, id)).run()
}

export function retryJob(
	db: Queryable,
	{ id, error, runAt }: { id: number; error: string; runAt: Date },
): void {
	db.update(jobs)
		.set({ status: 'queued', runAt, lastError: error, startedAt: null })
		.where(eq(jobs.id, id))
		.run()
}

export function failJob(
	db: Queryable,
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
export function requeueInterrupted(db: Queryable): void {
	db.update(jobs)
		.set({ status: 'queued', lastError: interrupted, startedAt: null })
		.where(eq(jobs.status, 'running'))
		.run()
}

/** The run a schedule has planned and not started yet: queued and never attempted. */
export function plannedRun(db: Queryable, kind: string): JobRow | undefined {
	return db
		.select()
		.from(jobs)
		.where(and(eq(jobs.status, 'queued'), eq(jobs.kind, kind), eq(jobs.attempts, 0)))
		.orderBy(asc(jobs.runAt))
		.limit(1)
		.get()
}

export function replanJob(
	db: Queryable,
	{ id, runAt, payload }: { id: number; runAt: Date; payload: unknown },
): void {
	db.update(jobs).set({ runAt, payload }).where(eq(jobs.id, id)).run()
}
