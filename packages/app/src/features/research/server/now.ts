// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { and, eq, exists, inArray } from 'drizzle-orm'
import * as v from 'valibot'

import { explanations } from '#/server/db/schema/explanations'
import { notes } from '#/server/db/schema/notes'

import { pendingResearchNoteIds } from './pending'
import { queueResearch, type QueueDependencies } from './pipeline'

/* The largest page of the notes list, so selecting a full page and pressing Research now fits. */
export const maxResearchNowNotes = 100

// Local on purpose: research may not import the notes feature's own id schema.
const rowId = v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(Number.MAX_SAFE_INTEGER))

/** The body of `POST /api/notes/research`. */
export const researchNowSchema = v.object({
	ids: v.pipe(
		v.array(rowId),
		v.minLength(1, 'Name at least one note.'),
		v.maxLength(maxResearchNowNotes, 'Name at most 100 notes.'),
	),
})

/*
 * What Research now did with a note: `queued` a job, found one `pending` already, found the card
 * `done`, or found no such note.
 */
export type ResearchNowOutcome = 'queued' | 'pending' | 'done' | 'not_found'

export interface ResearchNowResult {
	readonly id: number
	readonly outcome: ResearchNowOutcome
}

/*
 * Queues research with the `now` priority for each note that has no card and no job yet. Reading the
 * notes and the pending jobs and enqueueing happen with no await in between, so no other request and
 * not the nightly batch can add a job for the same note meanwhile. A crash part-way leaves jobs for
 * some notes, and a retry finds those pending and queues the rest, so it needs no transaction.
 */
export function researchNow(
	deps: QueueDependencies,
	noteIds: readonly number[],
): ResearchNowResult[] {
	const { db } = deps
	const ids = [...new Set(noteIds)]

	if (ids.length === 0) {
		return []
	}

	const finishedFirstCard = db
		.select({ id: explanations.id })
		.from(explanations)
		.where(
			and(
				eq(explanations.noteId, notes.id),
				eq(explanations.depth, 1),
				eq(explanations.isDraft, false),
			),
		)

	const found = new Map(
		db
			.select({
				id: notes.id,
				status: notes.status,
				deletedAt: notes.deletedAt,
				hasCard: exists(finishedFirstCard).mapWith(Boolean),
			})
			.from(notes)
			.where(inArray(notes.id, ids))
			.all()
			.map((note) => [note.id, note]),
	)

	const pending = pendingResearchNoteIds(db)
	const unarchive: number[] = []
	const reopen: number[] = []
	const toQueue: number[] = []

	const results = ids.map((id): ResearchNowResult => {
		const note = found.get(id)

		if (note === undefined || note.deletedAt !== null) {
			return { id, outcome: 'not_found' }
		}

		const archived = note.status === 'archived'

		// Its card is there to read, and this is the owner's only way back from the archive.
		if (note.hasCard) {
			if (archived) {
				unarchive.push(id)
			}

			return { id, outcome: 'done' }
		}

		// The job skips an archived note.
		if (archived) {
			reopen.push(id)
		}

		if (pending.has(id)) {
			return { id, outcome: 'pending' }
		}

		toQueue.push(id)

		return { id, outcome: 'queued' }
	})

	setStatus(deps, unarchive, 'ready')
	setStatus(deps, reopen, 'new')
	queueResearch(deps, toQueue, 'now')

	return results
}

function setStatus({ db }: QueueDependencies, noteIds: number[], status: 'ready' | 'new') {
	if (noteIds.length === 0) {
		return
	}

	db.update(notes)
		.set({ status })
		.where(and(inArray(notes.id, noteIds), eq(notes.status, 'archived')))
		.run()
}
