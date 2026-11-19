// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { sql } from 'drizzle-orm'
import { check, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

import { createdAt, timestamps } from './columns'

/** The one person an instance belongs to (D5); the check keeps the table to a single row. */
export const owner = sqliteTable(
	'owner',
	{
		id: integer('id').primaryKey(),
		passwordHash: text('password_hash').notNull(),
		...timestamps,
	},
	(table) => [check('owner_single_row', sql`${table.id} = 1`)],
)

/** Web sign-ins. The cookie carries a random token and only its hash is stored. */
export const sessions = sqliteTable('sessions', {
	tokenHash: text('token_hash').primaryKey(),
	createdAt,
	expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
})

/**
 * Browsers the owner has signed in from, each known by a long-lived cookie whose token is stored only
 * as a hash. Sign-in backoff counts their wrong passwords apart from everyone else's (D6).
 */
export const browsers = sqliteTable('browsers', {
	tokenHash: text('token_hash').primaryKey(),
	createdAt,
	lastSeenAt: integer('last_seen_at', { mode: 'timestamp_ms' }).notNull(),
})

/** Clients other than the web app (a Shortcut, an MCP client), each with a token revoked alone. */
export const devices = sqliteTable('devices', {
	id: integer('id').primaryKey(),
	name: text('name').notNull(),
	tokenHash: text('token_hash').notNull().unique(),
	createdAt,
	lastUsedAt: integer('last_used_at', { mode: 'timestamp_ms' }),
})
