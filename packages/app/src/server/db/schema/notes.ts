// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { sql } from 'drizzle-orm'
import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

import { timestamps } from './columns'

/** The kinds of note; each names the card format its research uses. */
export const categories = sqliteTable('categories', {
	id: integer('id').primaryKey(),
	name: text('name').notNull().unique(),
	icon: text('icon').notNull().default(''),
	color: text('color').notNull().default(''),
	format: text('format').notNull(),
	instructions: text('instructions').notNull().default(''),
	position: integer('position').notNull().default(0),
	...timestamps,
})

/**
 * Normalized terms, to spot repeats and suggest a category. A term with several senses keeps one row
 * per sense ("SABR: YouTube streaming" and "SABR: baseball").
 */
export const terms = sqliteTable(
	'terms',
	{
		id: integer('id').primaryKey(),
		term: text('term').notNull(),
		meaning: text('meaning').notNull().default(''),
		categoryId: integer('category_id').references(() => categories.id, { onDelete: 'set null' }),
		...timestamps,
	},
	(table) => [
		uniqueIndex('terms_term_meaning_idx').on(table.term, table.meaning),
		index('terms_category_id_idx').on(table.categoryId),
	],
)

/** Other normalized spellings that lead to a term. */
export const aliases = sqliteTable(
	'aliases',
	{
		alias: text('alias').notNull(),
		termId: integer('term_id')
			.notNull()
			.references(() => terms.id, { onDelete: 'cascade' }),
	},
	(table) => [
		primaryKey({ columns: [table.alias, table.termId] }),
		index('aliases_term_id_idx').on(table.termId),
	],
)

export const noteStatuses = [
	'new',
	'queued',
	'researching',
	'ready',
	'read',
	'archived',
	'failed',
] as const

export type NoteStatus = (typeof noteStatuses)[number]

/*
 * The search migration indexes `text` and `context` in the `search` FTS5 table with triggers on this
 * table: a migration that rebuilds it must create those triggers again (see migrations/README.md).
 */
export const notes = sqliteTable(
	'notes',
	{
		id: integer('id').primaryKey(),
		text: text('text').notNull(),
		context: text('context'),
		url: text('url'),
		source: text('source').notNull().default('web'),
		categoryId: integer('category_id').references(() => categories.id, { onDelete: 'set null' }),
		termId: integer('term_id').references(() => terms.id, { onDelete: 'set null' }),
		tags: text('tags', { mode: 'json' }).$type<string[]>().notNull().default([]),
		status: text('status', { enum: noteStatuses }).notNull().default('new'),
		isPrivate: integer('is_private', { mode: 'boolean' }).notNull().default(false),
		firstShownAt: integer('first_shown_at', { mode: 'timestamp_ms' }),
		expiresAt: integer('expires_at', { mode: 'timestamp_ms' }),
		keptAt: integer('kept_at', { mode: 'timestamp_ms' }),
		...timestamps,
	},
	(table) => [
		// The notes list, newest first: all of it, by status, or by category.
		index('notes_created_at_idx').on(table.createdAt),
		index('notes_status_created_at_idx').on(table.status, table.createdAt),
		index('notes_category_id_created_at_idx').on(table.categoryId, table.createdAt),
		index('notes_term_id_idx').on(table.termId),
		// Base: the kept notes, most recently kept first.
		index('notes_kept_at_idx')
			.on(table.keptAt)
			.where(sql`${table.keptAt} is not null`),
	],
)
