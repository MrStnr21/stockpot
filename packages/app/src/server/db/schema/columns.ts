// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { sql } from 'drizzle-orm'
import { integer } from 'drizzle-orm/sqlite-core'

/*
 * Times are Unix milliseconds in INTEGER columns, read as Date. Drizzle fills them from the clock in
 * code, so specs can move time with setSystemTime; the SQL default covers rows written by hand.
 */
export const currentTime = sql`(cast(unixepoch('subsec') * 1000 as integer))`

export const createdAt = integer('created_at', { mode: 'timestamp_ms' })
	.notNull()
	.default(currentTime)
	.$defaultFn(() => new Date())

export const updatedAt = integer('updated_at', { mode: 'timestamp_ms' })
	.notNull()
	.default(currentTime)
	.$defaultFn(() => new Date())
	.$onUpdateFn(() => new Date())

export const timestamps = { createdAt, updatedAt }
