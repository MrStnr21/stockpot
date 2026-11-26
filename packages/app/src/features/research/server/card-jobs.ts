// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

/*
 * The jobs behind an opened card: the research job writes level 1 and moves the note's status, a
 * deeper job writes the level its payload names. The worker takes running jobs first, then due queued
 * ones by priority, run time and id (server/jobs/queue.ts), so that order also counts the jobs ahead.
 */
import * as v from 'valibot'

import { failureKinds, type FailureKind, type JobView } from '#/features/research/shared/card-view'
import {
	jobsOfKinds,
	newestJobForNote,
	priorities,
	type JobSummary,
	type Queryable,
} from '#/server/jobs/queue'

const noteId = v.pipe(v.number(), v.integer())

const researchPayload = v.object({ noteId })

const deeperPayload = v.object({ noteId, depth: v.picklist([2, 3]) })

/** A job and the card level it writes, 1 to 3. */
interface LevelJob {
	readonly job: JobSummary
	readonly noteId: number
	readonly depth: 1 | 2 | 3
}

function levelJob(job: JobSummary): LevelJob | null {
	if (job.kind === 'research') {
		const parsed = v.safeParse(researchPayload, job.payload)

		return parsed.success ? { job, noteId: parsed.output.noteId, depth: 1 } : null
	}

	const parsed = v.safeParse(deeperPayload, job.payload)

	return parsed.success ? { job, ...parsed.output } : null
}

/** Whether the worker takes queued job `a` before queued job `b`. */
function takenBefore(a: JobSummary, b: JobSummary): boolean {
	if (a.priority !== b.priority) {
		return a.priority > b.priority
	}

	if (a.runAt.getTime() !== b.runAt.getTime()) {
		return a.runAt < b.runAt
	}

	return a.id < b.id
}

/** Running first, then the worker's order. */
function comesFirst(a: JobSummary, b: JobSummary): boolean {
	if ((a.status === 'running') !== (b.status === 'running')) {
		return a.status === 'running'
	}

	return takenBefore(a, b)
}

function jobView(job: JobSummary, active: readonly JobSummary[], now: Date): JobView {
	const running = job.status === 'running'

	const ahead = running
		? 0
		: active.filter(
				(other) =>
					other.id !== job.id &&
					(other.status === 'running' || (other.runAt <= now && takenBefore(other, job))),
			).length

	return {
		state: running ? 'researching' : 'queued',
		priority: job.priority >= priorities.now ? 'now' : 'batch',
		runAt: job.runAt.toISOString(),
		queuedAt: job.createdAt.toISOString(),
		ahead,
	}
}

export interface CardFailure {
	readonly kind: FailureKind
	readonly attempts: number
	readonly at: string
}

/** The kind in "The engine failed: <kind>" (research/server/engine-call.ts); anything else is `error`. */
export function failureKind(lastError: string | null): FailureKind {
	const kind = /^The engine failed: (?<kind>\w+)$/u.exec(lastError ?? '')?.groups?.kind

	return failureKinds.find((known) => known === kind) ?? 'error'
}

/**
 * The failure of the note's newest research job, or `null` when that job did not fail or there is
 * none. A rejected key ends its job as done (pipeline.ts), so an older failed job is never shown for
 * it: the card then gives the generic reason.
 */
function lastFailure(db: Queryable, id: number): CardFailure | null {
	const newest = newestJobForNote(db, 'research', id)

	if (newest?.status !== 'failed') {
		return null
	}

	return {
		kind: failureKind(newest.lastError),
		attempts: newest.attempts,
		at: (newest.finishedAt ?? newest.createdAt).toISOString(),
	}
}

export interface NoteJobs {
	/** The job each level waits on, level 1 first: the one the worker takes first. */
	readonly levels: readonly [JobView | null, JobView | null, JobView | null]
	readonly failure: CardFailure | null
}

/** The note's active jobs per level and, for a failed note, its last failure. */
export function noteJobs(
	db: Queryable,
	{ id, failed }: { id: number; failed: boolean },
	now: Date,
): NoteJobs {
	const active = jobsOfKinds(db, ['research', 'deeper'], ['queued', 'running'])
	const first: [JobSummary | null, JobSummary | null, JobSummary | null] = [null, null, null]

	for (const job of active) {
		const found = levelJob(job)
		const current = found === null ? null : first[found.depth - 1]

		if (found?.noteId === id && (current === null || comesFirst(job, current))) {
			first[found.depth - 1] = job
		}
	}

	function view(job: JobSummary | null) {
		return job === null ? null : jobView(job, active, now)
	}

	return {
		levels: [view(first[0]), view(first[1]), view(first[2])],
		failure: failed ? lastFailure(db, id) : null,
	}
}
