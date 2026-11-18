// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { sqliteTable, text } from 'drizzle-orm/sqlite-core'

import { updatedAt } from './columns'

/** Runtime settings the owner changes in the app, one JSON value per key; the settings feature validates them. */
export const settings = sqliteTable('settings', {
	key: text('key').primaryKey(),
	value: text('value', { mode: 'json' }).$type<unknown>().notNull(),
	updatedAt,
})
