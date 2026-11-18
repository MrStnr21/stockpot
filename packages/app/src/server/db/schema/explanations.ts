// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { sql } from 'drizzle-orm'
import { check, index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

import { timestamps } from './columns'
import { notes, terms } from './notes'

export interface CardSource {
	title: string
	url: string
}

/*
 * Cards: what an engine wrote for a note, or for a term and its sense, in a category's format. `body`
 * holds the format's blocks as JSON; the search migration indexes its string values in the `search`
 * FTS5 table with triggers on this table (see migrations/README.md).
 */
export const explanations = sqliteTable(
	'explanations',
	{
		id: integer('id').primaryKey(),
		noteId: integer('note_id').references(() => notes.id, { onDelete: 'cascade' }),
		termId: integer('term_id').references(() => terms.id, { onDelete: 'set null' }),
		format: text('format').notNull(),
		depth: integer('depth').notNull().default(1),
		language: text('language').notNull(),
		body: text('body', { mode: 'json' }).$type<unknown>().notNull(),
		sources: text('sources', { mode: 'json' }).$type<CardSource[]>().notNull().default([]),
		isUncertain: integer('is_uncertain', { mode: 'boolean' }).notNull().default(false),
		// Written by a fallback engine; the primary engine redoes it once its limit resets.
		isDraft: integer('is_draft', { mode: 'boolean' }).notNull().default(false),
		engine: text('engine').notNull(),
		model: text('model'),
		promptVersion: text('prompt_version').notNull(),
		...timestamps,
	},
	(table) => [
		check('explanations_subject', sql`${table.noteId} is not null or ${table.termId} is not null`),
		index('explanations_note_id_created_at_idx').on(table.noteId, table.createdAt),
		index('explanations_term_id_idx').on(table.termId),
	],
)
