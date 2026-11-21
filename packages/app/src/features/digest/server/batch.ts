// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { and, asc, eq, isNull, ne, notExists } from 'drizzle-orm'

import type { Db } from '#/server/db/client'
import { explanations } from '#/server/db/schema/explanations'
import { notes } from '#/server/db/schema/notes'
import type { JobDefinition, ScheduledRun } from '#/server/jobs/types'
import { log } from '#/server/log'

interface BatchDependencies {
	readonly db: Db
	readonly pending: () => ReadonlySet<number>
	readonly queue: (noteIds: readonly number[]) => void
}

export function createBatchJob({
	db,
	pending,
	queue,
}: BatchDependencies): JobDefinition<ScheduledRun> {
	return {
		kind: 'nightly-batch',
		async run({ day }) {
			// A request could queue research for the same note if this yields before enqueueing.
			const pendingIds = pending()

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

			const noteIds = db
				.select({ id: notes.id })
				.from(notes)
				.where(
					and(isNull(notes.deletedAt), ne(notes.status, 'archived'), notExists(finishedFirstCard)),
				)
				.orderBy(asc(notes.createdAt), asc(notes.id))
				.all()
				.map(({ id }) => id)
				.filter((id) => !pendingIds.has(id))

			queue(noteIds)
			log.info('Queued the nightly batch', { day, notes: noteIds.length })
		},
	}
}
