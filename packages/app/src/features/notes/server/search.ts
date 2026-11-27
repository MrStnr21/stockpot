// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

/*
 * Search reads the `note_search` FTS5 index (schema v1 migration), one row per note keyed by its id.
 * The owner's text never reaches MATCH as written: `toFtsQuery` keeps only its words, each quoted, so
 * quotes, `*`, `-`, `:`, NEAR, OR and column names are plain words. Results are newest first, like the
 * list, so the same cursor pages both; relevance is not used.
 */
import { and, count, desc, eq, sql, type SQL } from 'drizzle-orm'
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

import type { Db } from '#/server/db/client'
import { notes } from '#/server/db/schema/notes'

/* Hand-written in the migration (drizzle-kit does not model FTS5); declared here only to query it, and
 * outside the schema folder so drizzle-kit never generates it. */
const noteSearch = sqliteTable('note_search', {
	rowid: integer('rowid').notNull(),
	text: text('text'),
	context: text('context'),
	cards: text('cards'),
})

// Enough for a phrase; more words only narrow a result that is already small.
const maxSearchTokens = 8

/** A part of a snippet; `match` parts are the words the search found. */
export interface SnippetSegment {
	readonly text: string
	readonly match: boolean
}

/** The FTS5 query for what the owner typed: every word, the last as a prefix; null without words. */
export function toFtsQuery(input: string): string | null {
	const tokens = input.normalize('NFKC').match(/[\p{L}\p{N}\p{M}]+/gu) ?? []
	const kept = tokens.slice(0, maxSearchTokens)

	if (kept.length === 0) {
		return null
	}

	return kept.map((token, index) => `"${token}"${index === kept.length - 1 ? '*' : ''}`).join(' ')
}

// The snippet() function marks matches with these control characters; any in a note are dropped too.
const openMark = '\u0002'

const closeMark = '\u0003'

/** Splits a marked snippet into plain and matched parts; a stray marker in the note's text is dropped. */
export function snippetSegments(snippet: string): SnippetSegment[] {
	const segments: SnippetSegment[] = []
	let match = false
	let current = ''

	function flush() {
		const last = segments.at(-1)

		if (current === '') {
			return
		}

		if (last?.match === match) {
			segments[segments.length - 1] = { text: last.text + current, match }
		} else {
			segments.push({ text: current, match })
		}

		current = ''
	}

	for (const char of snippet) {
		if (char === openMark || char === closeMark) {
			flush()
			match = char === openMark
		} else {
			current += char
		}
	}

	flush()

	return segments
}

function matches(match: string) {
	return and(eq(notes.id, noteSearch.rowid), sql`${noteSearch} MATCH ${match}`)
}

/*
 * The index is read first (CROSS JOIN fixes the order) and each note by its id, so no search scans
 * `notes`; the matches are sorted in memory, which for a personal collection is a few hundred rows.
 */
export interface MatchQuery {
	/** The FTS5 query from `toFtsQuery`. */
	readonly match: string
	/** The list's other conditions: live notes, filters and the cursor. */
	readonly where: SQL | undefined
	readonly limit: number
	/** Newest created first unless given; Base passes the kept time. */
	readonly orderBy?: SQL[]
}

const newestCreated = [desc(notes.createdAt), desc(notes.id)]

// oxlint-disable-next-line typescript/explicit-module-boundary-types -- The Drizzle query type is long; listNotes runs it.
export function selectMatches(
	db: Db,
	{ match, where, limit, orderBy = newestCreated }: MatchQuery,
) {
	return db
		.select({
			note: notes,
			snippet: sql<string>`snippet(${noteSearch}, -1, char(2), char(3), '…', 12)`,
		})
		.from(noteSearch)
		.crossJoin(notes)
		.where(and(matches(match), where))
		.orderBy(...orderBy)
		.limit(limit)
}

/** How many notes match under the filters, on every page. */
export function countMatches(
	db: Db,
	{ match, where }: Omit<MatchQuery, 'limit' | 'orderBy'>,
): number {
	const row = db
		.select({ total: count() })
		.from(noteSearch)
		.crossJoin(notes)
		.where(and(matches(match), where))
		.get()

	return row?.total ?? 0
}
