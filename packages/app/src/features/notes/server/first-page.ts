// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

/*
 * The first page of the notes list as the page hands it to the island: the same rows `GET /api/notes`
 * sends, with their dates as ISO strings, the way JSON carries them.
 */
import type { Db } from '#/server/db/client'

import type { NoteFilters } from '../shared/filters'
import type { NoteRow, NotesPage } from '../shared/types'
import { listNotes, type ListedNote } from './list'

export function toNoteRow(note: ListedNote): NoteRow {
	return {
		...note,
		createdAt: note.createdAt.toISOString(),
		updatedAt: note.updatedAt.toISOString(),
	}
}

/** The view's first page, at the default page size. */
export function firstPage(db: Db, filters: NoteFilters): NotesPage {
	const page = listNotes(db, {
		status: filters.status ?? undefined,
		categoryId: filters.categoryId ?? undefined,
		q: filters.q === '' ? undefined : filters.q,
	})

	return {
		notes: page.notes.map((note) => toNoteRow(note)),
		nextCursor: page.nextCursor,
		total: page.total,
	}
}
