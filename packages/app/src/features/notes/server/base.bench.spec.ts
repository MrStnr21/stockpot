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

import { baseNotesQuerySchema } from '../schemas'
import { listKept, readBase } from './base'

const noteCount = 1000

const runs = 100

const day = 24 * 60 * 60 * 1000

/** The nearest-rank percentile of a list of times: the p95 of 100 runs is the 95th fastest. */
function percentile(times: readonly number[], share: number) {
	const sorted = times.toSorted((a, b) => a - b)

	return sorted[Math.ceil(share * sorted.length) - 1] ?? Number.POSITIVE_INFINITY
}

/* A full collection over 60 days: every status, the built-in categories and some notes without
 * one, some private, every third note kept and every other one with a first card, written in one
 * transaction. */
function seedNotes(db: Db) {
	const categoryIds = [
		...db
			.select({ id: categories.id })
			.from(categories)
			.all()
			.map(({ id }) => id),
		null,
	]

	const now = Date.now()

	db.transaction((tx) => {
		for (let index = 0; index < noteCount; index += 1) {
			const createdAt = new Date(now - Math.floor((index / noteCount) * 60 * day))

			const note = tx
				.insert(notes)
				.values({
					text: `${faker.word.noun()} ${index}`,
					context: faker.lorem.sentence(),
					status: noteStatuses[index % noteStatuses.length],
					categoryId: categoryIds[index % categoryIds.length],
					isPrivate: index % 10 === 0,
					keptAt: index % 3 === 0 ? new Date(createdAt.getTime() + day) : null,
					createdAt,
				})
				.returning({ id: notes.id })
				.get()

			if (index % 2 === 0) {
				tx.insert(explanations)
					.values({
						noteId: note.id,
						format: 'technology',
						language: 'en',
						body: { sense: faker.lorem.words(3), summary: faker.lorem.paragraph() },
						isUncertain: index % 8 === 0,
						engine: 'agent-command',
						promptVersion: 'v1',
					})
					.run()
			}
		}
	})

	return { categoryId: categoryIds[0] }
}

describe('readBase and listKept on a database file', () => {
	const folder = join(tmpdir(), `stockpot-base-budget-${crypto.randomUUID()}`)
	let sqlite: Database
	const p95 = new Map<string, number>()

	/* A page renders in < 100 ms; the server's share is the Base overview, a group's page or a
	 * search, timed here on a file opened like the server's (WAL). */
	beforeAll(async () => {
		await $`mkdir -p ${folder}`.quiet()
		const opened = await openDatabase({ path: join(folder, 'stockpot.db'), migrationsFolder })

		const { db } = opened

		;({ sqlite } = opened)

		const { categoryId } = seedNotes(db)

		const [word = 'lorem'] = (
			db.select({ context: notes.context }).from(notes).limit(1).get()?.context ?? ''
		).split(' ')

		const categoryPage = v.parse(baseNotesQuerySchema, { categoryId: String(categoryId) })
		const search = v.parse(baseNotesQuerySchema, { q: word.slice(0, 3) })

		const cases = {
			'the overview': () => {
				readBase(db)
			},
			'a category page': () => {
				listKept(db, categoryPage)
			},
			'a search': () => {
				listKept(db, search)
			},
		}

		for (const [name, read] of Object.entries(cases)) {
			const times = Array.from({ length: runs }, () => {
				const start = nanoseconds()

				read()

				return (nanoseconds() - start) / 1e6
			})

			p95.set(name, percentile(times, 0.95))
		}
	})

	afterAll(async () => {
		sqlite.close()
		await $`rm -rf ${folder}`.quiet()
	})

	it.each(['the overview', 'a category page', 'a search'])(
		`answers %s over ${noteCount} notes with a p95 under 50 ms`,
		(name) => {
			expect(p95.get(name)).toBeLessThan(50)
		},
	)
})
