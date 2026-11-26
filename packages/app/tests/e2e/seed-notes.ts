// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { Database } from 'bun:sqlite'
import { faker } from '@faker-js/faker'

const statuses = ['new', 'queued', 'researching', 'ready', 'read', 'archived', 'failed'] as const

const day = 24 * 60 * 60 * 1000

/*
 * Writes a full collection straight into a running server's database, in one transaction: every
 * status, the built-in categories, every tenth note private, spread over 60 days, and a first card
 * for every third note. The search index fills itself through its triggers. Answers a word that the
 * first note's context holds, to search for.
 */
export function seedNotes(dataDir: string, count: number): string {
	const db = new Database(`${dataDir}/stockpot.db`)

	try {
		db.run('PRAGMA busy_timeout = 5000')

		const categoryIds = db
			.query<{ id: number }, []>('SELECT id FROM categories ORDER BY id')
			.all()
			.map(({ id }) => id)

		const addNote = db.query<
			{ id: number },
			[string, string, string, number | null, number, number]
		>(
			`INSERT INTO notes (text, context, status, category_id, is_private, created_at, updated_at)
			VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6) RETURNING id`,
		)

		const addCard = db.query<null, [number, string, number]>(
			`INSERT INTO explanations (note_id, format, depth, language, body, is_uncertain, engine, prompt_version)
			VALUES (?1, 'technology', 1, 'en', ?2, ?3, 'agent-command', 'v1')`,
		)

		const now = Date.now()
		const contexts = Array.from({ length: count }, () => faker.lorem.sentence())

		db.transaction(() => {
			for (let index = 0; index < count; index += 1) {
				const note = addNote.get(
					`${faker.word.noun()} ${index}`,
					contexts[index] ?? '',
					statuses[index % statuses.length] ?? 'new',
					categoryIds[index % categoryIds.length] ?? null,
					index % 10 === 0 ? 1 : 0,
					now - Math.floor((index / count) * 60 * day),
				)

				if (note !== null && index % 3 === 0) {
					const body = { sense: faker.lorem.words(3), summary: faker.lorem.paragraph() }

					addCard.run(note.id, JSON.stringify(body), index % 9 === 0 ? 1 : 0)
				}
			}
		})()

		return (contexts[0] ?? '').split(' ')[0]?.toLowerCase() ?? ''
	} finally {
		db.close()
	}
}
