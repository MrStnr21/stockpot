// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { $, nanoseconds } from 'bun'
import type { Database } from 'bun:sqlite'
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { faker } from '@faker-js/faker'
import { migrationsFolder } from '#tests/setup/db'
import * as v from 'valibot'

import { openDatabase, type Db } from '#/server/db/client'
import { explanations } from '#/server/db/schema/explanations'
import { categories, notes, noteStatuses } from '#/server/db/schema/notes'

import { notesQuerySchema } from '../schemas'
import { countNotes } from './counts'
import { listNotes } from './list'

const noteCount = 1000

const runs = 100

const day = 24 * 60 * 60 * 1000

/** The nearest-rank percentile of a list of times: the p95 of 100 runs is the 95th fastest. */
function percentile(times: readonly number[], share: number) {
	const sorted = times.toSorted((a, b) => a - b)

	return sorted[Math.ceil(share * sorted.length) - 1] ?? Number.POSITIVE_INFINITY
}

/* A full collection: every status, the built-in categories, some private, spread over
 * 60 days, and a first card for every third note, written in one transaction. */
function seedNotes(db: Db) {
	const categoryIds = db
		.select({ id: categories.id })
		.from(categories)
		.all()
		.map(({ id }) => id)

	const now = Date.now()

	db.transaction((tx) => {
		for (let index = 0; index < noteCount; index += 1) {
			const note = tx
				.insert(notes)
				.values({
					text: `${faker.word.noun()} ${index}`,
					context: faker.lorem.sentence(),
					status: noteStatuses[index % noteStatuses.length],
					categoryId: categoryIds[index % categoryIds.length],
					isPrivate: index % 10 === 0,
					createdAt: new Date(now - Math.floor((index / noteCount) * 60 * day)),
				})
				.returning({ id: notes.id })
				.get()

			if (index % 3 === 0) {
				tx.insert(explanations)
					.values({
						noteId: note.id,
						format: 'technology',
						language: 'en',
						body: { sense: faker.lorem.words(3), summary: faker.lorem.paragraph() },
						isUncertain: index % 9 === 0,
						engine: 'agent-command',
						promptVersion: 'v1',
					})
					.run()
			}
		}
	})

	return { categoryId: categoryIds[0] }
}

describe('listNotes and countNotes on a database file', () => {
	const folder = join(tmpdir(), `stockpot-list-budget-${crypto.randomUUID()}`)
	let sqlite: Database
	const p95 = new Map<string, number>()

	/* The page with 1,000 notes must render in < 200 ms (WEB-4); the server's share is a page of the
	 * list and the counts, timed here on a file opened like the server's (WAL), per filter. */
	beforeAll(async () => {
		await $`mkdir -p ${folder}`.quiet()
		const opened = await openDatabase({ path: join(folder, 'stockpot.db'), migrationsFolder })

		const { db } = opened

		;({ sqlite } = opened)

		const { categoryId } = seedNotes(db)

		const [word = 'lorem'] = (
			db.select({ context: notes.context }).from(notes).limit(1).get()?.context ?? ''
		).split(' ')

		const cases = {
			'no filter': {},
			'a status': { status: 'ready' },
			'a category': { categoryId: String(categoryId) },
			'a search': { q: word.slice(0, 3) },
		}

		for (const [name, params] of Object.entries(cases)) {
			const query = v.parse(notesQuerySchema, params)

			const times = Array.from({ length: runs }, () => {
				const start = nanoseconds()

				listNotes(db, query)
				countNotes(db)

				return (nanoseconds() - start) / 1e6
			})

			p95.set(name, percentile(times, 0.95))
		}
	})

	afterAll(async () => {
		sqlite.close()
		await $`rm -rf ${folder}`.quiet()
	})

	it.each(['no filter', 'a status', 'a category', 'a search'])(
		`answers a page and the counts of ${noteCount} notes for %s with a p95 under 50 ms`,
		(name) => {
			expect(p95.get(name)).toBeLessThan(50)
		},
	)
})
