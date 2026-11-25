// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { and, eq, isNull } from 'drizzle-orm'
import * as v from 'valibot'

import type { Db } from '#/server/db/client'
import { explanations } from '#/server/db/schema/explanations'
import { notes } from '#/server/db/schema/notes'
import type { Priority } from '#/server/jobs/queue'

import type { DeeperPayload } from './depth'
import { activeDeeperJobs } from './pending'

/** The body of `POST /api/notes/:id/deeper`: `{}` waits for tonight's batch, `{ now: true }` runs at once. */
export const deeperSchema = v.strictObject({ now: v.optional(v.boolean(), false) })

/*
 * What a request for a deeper level did: `queued` a job, found one `pending` already, found the
 * `deepest` level written, or found the note has no card to go deeper from or does not exist.
 */
export type DeeperOutcome = 'queued' | 'pending' | 'deepest' | 'no_card' | 'not_found'

export interface DeeperResult {
	readonly id: number
	readonly outcome: DeeperOutcome
	/** The level asked for, or 3 when it is written already; null when there is no such level to name. */
	readonly depth: 2 | 3 | null
}

export interface DeeperQueueDependencies {
	readonly db: Db
	readonly enqueue: (payload: DeeperPayload, priority: Priority) => void
}

/*
 * Asks for the next level of a note's card: one more than the deepest level written, a draft
 * included, so a request never skips a level. At most one `now` and one `batch` job are active per
 * note and level, whoever asks: a `now` request while only a batch job waits adds a `now` job, and
 * the batch job then finds the level written and skips. Reading and enqueueing happen with no await
 * in between, so no other request can add a job for the same level meanwhile.
 */
export function requestDeeper(
	{ db, enqueue }: DeeperQueueDependencies,
	noteId: number,
	{ now }: { now: boolean },
): DeeperResult {
	const note = db
		.select({ status: notes.status })
		.from(notes)
		.where(and(eq(notes.id, noteId), isNull(notes.deletedAt)))
		.get()

	if (note === undefined) {
		return { id: noteId, outcome: 'not_found', depth: null }
	}

	const written = db
		.select({ depth: explanations.depth })
		.from(explanations)
		.where(eq(explanations.noteId, noteId))
		.all()
		.map(({ depth }) => depth)

	if (!written.includes(1)) {
		return { id: noteId, outcome: 'no_card', depth: null }
	}

	// Research is the owner's way back from the archive, and this note has a card to read.
	if (note.status === 'archived') {
		db.update(notes)
			.set({ status: 'ready' })
			.where(and(eq(notes.id, noteId), eq(notes.status, 'archived')))
			.run()
	}

	const deepest = Math.max(...written)

	if (deepest >= 3) {
		return { id: noteId, outcome: 'deepest', depth: 3 }
	}

	const depth = deepest === 1 ? 2 : 3

	const covering = activeDeeperJobs(db).filter(
		(job) => job.noteId === noteId && job.depth === depth && (!now || job.now === true),
	)

	if (covering.length > 0) {
		return { id: noteId, outcome: 'pending', depth }
	}

	enqueue(now ? { noteId, depth, now: true } : { noteId, depth }, now ? 'now' : 'batch')

	return { id: noteId, outcome: 'queued', depth }
}
