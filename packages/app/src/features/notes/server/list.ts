// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

/*
 * The notes list, newest first, filtered and searched. Notes are ordered by creation time and id,
 * which never change after insert, so the keyset cursor neither repeats nor skips a note that matches
 * when its page is read. Deleted notes are never listed.
 */
import { and, desc, eq, isNull, sql } from 'drizzle-orm'

import type { Db } from '#/server/db/client'
import { notes } from '#/server/db/schema/notes'

import { defaultPageSize, encodeCursor, type NotesQuery } from '../schemas'
import { cardFacts, type CardFlag } from './cards'
import { toPublicNote, type NoteRow, type PublicNote } from './public-note'
import {
	countMatches,
	selectMatches,
	snippetSegments,
	toFtsQuery,
	type SnippetSegment,
} from './search'

/** A note as the list shows it: with its card's sense and flag, and the search snippet. */
export interface ListedNote extends PublicNote {
	readonly sense: string | null
	readonly flag: CardFlag | null
	/** Only with a search: where the note matched, the matched words marked. */
	readonly snippet: SnippetSegment[] | null
}

export interface NotesPage {
	readonly notes: ListedNote[]
	/** Pass as `cursor` for the next page; `null` on the last one. */
	readonly nextCursor: string | null
	/** Only with a search: how many notes match under the filters. */
	readonly total: number | null
}

type Filters = Pick<NotesQuery, 'status' | 'categoryId' | 'cursor'>

/** The conditions every list and search page shares: live notes, the filters and the cursor. */
// oxlint-disable-next-line typescript/explicit-module-boundary-types -- A Drizzle condition; the queries take it as is.
export function noteFilters({ status, categoryId, cursor }: Filters) {
	const afterCursor =
		cursor === undefined
			? undefined
			: sql`(${notes.createdAt}, ${notes.id}) < (${cursor.createdAt}, ${cursor.id})`

	return and(
		isNull(notes.deletedAt),
		status === undefined ? undefined : eq(notes.status, status),
		categoryId === undefined ? undefined : eq(notes.categoryId, categoryId),
		afterCursor,
	)
}

/**
 * The list query, newest first, one row past the page so the page knows whether another follows.
 * Exported so a spec can assert that each filter reads its index: `created_at` alone, or after
 * `status` or `category_id`, with the id as the tie-break that every index already ends with.
 */
// oxlint-disable-next-line typescript/explicit-module-boundary-types -- The Drizzle query type is long; listNotes runs it.
export function selectNotes(db: Db, query: NotesQuery) {
	return db
		.select()
		.from(notes)
		.where(noteFilters(query))
		.orderBy(desc(notes.createdAt), desc(notes.id))
		.limit((query.limit ?? defaultPageSize) + 1)
}

/** A note a query found, with its search snippet when a search found it. */
export interface Found {
	readonly row: NoteRow
	readonly snippet: SnippetSegment[] | null
}

interface FoundRows {
	/** Up to one row past the page. */
	readonly found: Found[]
	readonly limit: number
	readonly total: number | null
}

/** The notes as a list row shows them, with their cards' sense and flag read in one query. */
export function toListed(db: Db, found: readonly Found[]): ListedNote[] {
	const cards = cardFacts(
		db,
		found.map(({ row }) => row.id),
	)

	return found.map(({ row, snippet }) =>
		Object.assign(toPublicNote(row), {
			sense: cards.get(row.id)?.sense ?? null,
			flag: cards.get(row.id)?.flag ?? null,
			snippet,
		}),
	)
}

function toPage(db: Db, { found, limit, total }: FoundRows): NotesPage {
	const page = found.slice(0, limit)
	const last = page.at(-1)

	return {
		notes: toListed(db, page),
		nextCursor: found.length > limit && last !== undefined ? encodeCursor(last.row) : null,
		total,
	}
}

/** One page of the notes that are not deleted, newest first; with `q`, only the notes that match it. */
export function listNotes(db: Db, query: NotesQuery): NotesPage {
	const limit = query.limit ?? defaultPageSize

	if (query.q === undefined) {
		const rows = selectNotes(db, query).all()
		const found = rows.map((row) => ({ row, snippet: null }))

		return toPage(db, { found, limit, total: null })
	}

	const match = toFtsQuery(query.q)

	// Only punctuation or symbols: nothing to look for, and nothing to send to MATCH.
	if (match === null) {
		return { notes: [], nextCursor: null, total: 0 }
	}

	const matches = selectMatches(db, { match, where: noteFilters(query), limit: limit + 1 }).all()

	const found = matches.map(({ note, snippet }) => ({
		row: note,
		snippet: snippetSegments(snippet),
	}))

	const where = noteFilters({ ...query, cursor: undefined })
	const total = countMatches(db, { match, where })

	return toPage(db, { found, limit, total })
}

/** A note that is not deleted, or undefined. */
export function getNote(db: Db, id: number): PublicNote | undefined {
	const row = db
		.select()
		.from(notes)
		.where(and(eq(notes.id, id), isNull(notes.deletedAt)))
		.get()

	return row === undefined ? undefined : toPublicNote(row)
}
