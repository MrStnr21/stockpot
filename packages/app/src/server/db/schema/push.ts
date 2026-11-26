// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { sql } from 'drizzle-orm'
import { check, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

import { createdAt } from './columns'

/** Web Push subscriptions, one per browser that allowed notifications. */
export const pushSubscriptions = sqliteTable('push_subscriptions', {
	id: integer('id').primaryKey(),
	endpoint: text('endpoint').notNull().unique(),
	p256dh: text('p256dh').notNull(),
	auth: text('auth').notNull(),
	expiresAt: integer('expires_at', { mode: 'timestamp_ms' }),
	/** The browser's language when it subscribed, so each device gets notifications in its own. */
	locale: text('locale').notNull().default('en'),
	createdAt,
})

/*
 * The instance's VAPID key pair (RFC 8292), made on first start; the check keeps the table to a single
 * row. It lives in the database rather than a file because every subscription is bound to the public
 * key: a backup restores both together, under the same owner-only permissions as the engine keys.
 */
export const pushKeys = sqliteTable(
	'push_keys',
	{
		id: integer('id').primaryKey(),
		/** Base64url of the 65-byte uncompressed P-256 point, the browser's `applicationServerKey`. */
		publicKey: text('public_key').notNull(),
		/** Base64url of the private scalar, the JWK's `d`. */
		privateKey: text('private_key').notNull(),
		createdAt,
	},
	(table) => [check('push_keys_single_row', sql`${table.id} = 1`)],
)
