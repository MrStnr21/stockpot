// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

import { createdAt } from './columns'

/** Web Push subscriptions, one per browser that allowed notifications. */
export const pushSubscriptions = sqliteTable('push_subscriptions', {
	id: integer('id').primaryKey(),
	endpoint: text('endpoint').notNull().unique(),
	p256dh: text('p256dh').notNull(),
	auth: text('auth').notNull(),
	expiresAt: integer('expires_at', { mode: 'timestamp_ms' }),
	createdAt,
})
