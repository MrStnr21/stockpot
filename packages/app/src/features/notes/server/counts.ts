// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { count, isNull } from 'drizzle-orm'

import type { Db } from '#/server/db/client'
import { notes, type NoteStatus } from '#/server/db/schema/notes'

/** How many live notes share a category and a status; the filters derive every chip's count from these. */
export interface NoteCount {
	readonly categoryId: number | null
	readonly status: NoteStatus
	readonly count: number
}

/*
 * The aggregate reads every live note by design: an index would only make it a covering scan. The
 * list bench (list.bench.spec.ts) measures it with 1,000 notes. Counts ignore the search.
 */
export function countNotes(db: Db): NoteCount[] {
	return db
		.select({ categoryId: notes.categoryId, status: notes.status, count: count() })
		.from(notes)
		.where(isNull(notes.deletedAt))
		.groupBy(notes.categoryId, notes.status)
		.all()
}
