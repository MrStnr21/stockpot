// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { Database } from 'bun:sqlite'

import { readyFrames } from './card-frames'
import { stateFrames } from './card-frames-states'

/*
 * One note per frame of the Cards · 390 board (01–15), and a private English note, written straight
 * into a running server's database: the notes, their cards at each level, and the jobs behind the
 * waiting ones. Answers the id of each frame's note.
 */
const notes = [...readyFrames, ...stateFrames]

const minute = 60_000

/** Writes every frame's note; answers the note id of each frame key, such as `01` or `private`. */
export function seedCards(dataDir: string): Map<string, number> {
	const db = new Database(`${dataDir}/stockpot.db`)

	try {
		db.run('PRAGMA busy_timeout = 5000')

		const categories = new Map(
			db
				.query<{ id: number; format: string }, []>('SELECT id, format FROM categories')
				.all()
				.map(({ id, format }) => [format, id]),
		)

		const ids = new Map<string, number>()
		const now = Date.now()

		db.transaction(() => {
			// Each frame a minute older than the one before, so the list shows frame 01 at the top.
			notes.forEach((note, index) => {
				const createdAt = now - (index + 1) * minute

				const row = db
					.query<{ id: number }, [string, string, string, number | null, number, number]>(
						`INSERT INTO notes (text, context, status, category_id, is_private, created_at, updated_at)
						VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6) RETURNING id`,
					)
					.get(
						note.text,
						note.context,
						note.status,
						categories.get(note.format) ?? null,
						note.isPrivate === true ? 1 : 0,
						createdAt,
					)

				if (row === null) {
					throw new Error(`The note of frame ${note.key} was not written.`)
				}

				ids.set(note.key, row.id)

				for (const card of note.cards ?? []) {
					db.run(
						`INSERT INTO explanations (note_id, format, depth, language, body, sources, is_uncertain,
							is_draft, engine, model, prompt_version, created_at, updated_at)
						VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, NULL, 'v1', ?10, ?10)`,
						[
							row.id,
							note.format,
							card.depth,
							card.language ?? 'en',
							JSON.stringify(card.body),
							JSON.stringify(card.sources ?? []),
							card.isUncertain === true ? 1 : 0,
							card.isDraft === true ? 1 : 0,
							card.engine ?? 'gemini',
							createdAt + card.depth * minute,
						],
					)
				}

				for (const job of note.jobs ?? []) {
					const payload =
						job.kind === 'research'
							? { noteId: row.id, ...(job.priority === 'now' && { now: true }) }
							: { noteId: row.id, depth: job.depth }

					db.run(
						`INSERT INTO jobs (kind, payload, priority, run_at, status, attempts, last_error,
							finished_at, created_at, updated_at)
						VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9)`,
						[
							job.kind,
							JSON.stringify(payload),
							job.priority === 'now' ? 10 : 0,
							now + job.runIn * minute,
							job.status,
							job.attempts ?? 0,
							job.lastError ?? null,
							job.status === 'failed' ? now - 20 * minute : null,
							now - 5 * minute,
						],
					)
				}
			})
		})()

		return ids
	} finally {
		db.close()
	}
}

/** The id of the built-in category with this card format, such as `report` for Idea. */
export function categoryIdOf(dataDir: string, format: string): number {
	const db = new Database(`${dataDir}/stockpot.db`)

	try {
		const row = db
			.query<{ id: number }, [string]>('SELECT id FROM categories WHERE format = ?1 ORDER BY id')
			.get(format)

		if (row === null) {
			throw new Error(`No category has the ${format} format.`)
		}

		return row.id
	} finally {
		db.close()
	}
}
