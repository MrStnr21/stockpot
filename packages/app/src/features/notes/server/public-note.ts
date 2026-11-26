// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import type { Db } from '#/server/db/client'
import type { notes, NoteStatus } from '#/server/db/schema/notes'

/** A note as it leaves the server. */
export interface PublicNote {
	readonly id: number
	readonly text: string
	readonly context: string | null
	readonly url: string | null
	readonly source: string
	readonly categoryId: number | null
	readonly status: NoteStatus
	readonly private: boolean
	readonly createdAt: Date
	readonly updatedAt: Date
}

export type NoteRow = typeof notes.$inferSelect

/** The database or a transaction on it: both run the same synchronous queries. */
export type Queries = Db | Parameters<Parameters<Db['transaction']>[0]>[0]

export function toPublicNote(row: NoteRow): PublicNote {
	return {
		id: row.id,
		text: row.text,
		context: row.context,
		url: row.url,
		source: row.source,
		categoryId: row.categoryId,
		status: row.status,
		private: row.isPrivate,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
	}
}
