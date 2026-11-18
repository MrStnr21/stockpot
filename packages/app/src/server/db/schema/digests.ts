// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

import { createdAt } from './columns'
import { notes } from './notes'

/** One morning's set of cards; `day` is the date in the time zone from settings, as YYYY-MM-DD. */
export const digests = sqliteTable('digests', {
	id: integer('id').primaryKey(),
	day: text('day').notNull().unique(),
	createdAt,
	openedAt: integer('opened_at', { mode: 'timestamp_ms' }),
})

export const digestActions = ['understood', 'deeper', 'kept', 'dismissed'] as const

export type DigestAction = (typeof digestActions)[number]

export const digestItems = sqliteTable(
	'digest_items',
	{
		digestId: integer('digest_id')
			.notNull()
			.references(() => digests.id, { onDelete: 'cascade' }),
		noteId: integer('note_id')
			.notNull()
			.references(() => notes.id, { onDelete: 'cascade' }),
		position: integer('position').notNull(),
		action: text('action', { enum: digestActions }),
		actedAt: integer('acted_at', { mode: 'timestamp_ms' }),
	},
	(table) => [
		primaryKey({ columns: [table.digestId, table.noteId] }),
		// Today: the digest's cards in order.
		uniqueIndex('digest_items_digest_id_position_idx').on(table.digestId, table.position),
		index('digest_items_note_id_idx').on(table.noteId),
	],
)
