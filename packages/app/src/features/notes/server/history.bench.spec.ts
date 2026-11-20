// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { $, nanoseconds } from 'bun'
import type { Database } from 'bun:sqlite'
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { explanationRowFactory } from '#tests/factories/explanations'
import { noteRowFactory } from '#tests/factories/notes'
import { aliasRowFactory, termRowFactory } from '#tests/factories/terms'
import { migrationsFolder } from '#tests/setup/db'
import { drizzle } from 'drizzle-orm/bun-sqlite'
import * as v from 'valibot'

import { openDatabase, type Db } from '#/server/db/client'
import { explanations } from '#/server/db/schema/explanations'
import { aliases, notes, terms } from '#/server/db/schema/notes'

import { findTermRows, matchHistory } from './history'

const termCount = 10_000

const lookupCount = 200

const batchSize = 100

function seedHistory(db: Db) {
	const lookups: { termId: number; text: string }[] = []

	db.transaction((tx) => {
		for (let offset = 0; offset < termCount; offset += batchSize) {
			const termRows = Array.from({ length: batchSize }, (_, index) => {
				const id = offset + index + 1
				const { term } = termRowFactory.build()

				return { id, term: `${id} ${term}` }
			})

			const aliasRows = termRows.map(({ id: termId, term }) => {
				const row = aliasRowFactory.build({ termId })

				if ((termId - 1) % (termCount / lookupCount) === 0) {
					const text = lookups.length % 2 === 0 ? term : row.alias

					lookups.push({ termId, text })
				}

				return row
			})

			const noteRows = termRows.flatMap(({ id: termId }) => [
				noteRowFactory.build({ id: termId * 2 - 1, termId, status: 'read' }),
				noteRowFactory.build({ id: termId * 2, termId, status: termId % 3 === 0 ? 'new' : 'read' }),
			])

			const cardRows = termRows.map(({ id: termId }) =>
				explanationRowFactory.build({
					id: termId,
					...(termId % 3 === 0 ? { termId } : { noteId: termId * 2 - 1 }),
				}),
			)

			tx.insert(terms).values(termRows).run()
			tx.insert(aliases).values(aliasRows).run()
			tx.insert(notes).values(noteRows).run()
			tx.insert(explanations).values(cardRows).run()
		}
	})

	return lookups
}

describe('matchHistory on a database file', () => {
	const folder = join(tmpdir(), `stockpot-history-budget-${crypto.randomUUID()}`)
	let sqlite: Database
	let db: Db
	let lookups: ReturnType<typeof seedHistory>

	beforeAll(async () => {
		await $`mkdir -p ${folder}`.quiet()
		;({ sqlite, db } = await openDatabase({ path: join(folder, 'stockpot.db'), migrationsFolder }))
		lookups = seedHistory(db)
	})

	afterAll(async () => {
		sqlite.close()
		await $`rm -rf ${folder}`.quiet()
	})

	it(`matches ${lookupCount} existing terms with a p95 under 20 ms`, () => {
		expect(lookups).toHaveLength(lookupCount)

		const times = lookups.map(({ termId, text }) => {
			const start = nanoseconds()
			const matches = matchHistory(db, text)
			const elapsed = (nanoseconds() - start) / 1e6

			expect(matches).toMatchObject([{ termId, lastCard: { id: termId } }])

			return elapsed
		})

		const p95 =
			times.toSorted((a, b) => a - b)[Math.ceil(0.95 * times.length) - 1] ??
			Number.POSITIVE_INFINITY

		expect(p95).toBeLessThan(20)
	})

	it('looks up spellings with the term index and the alias primary key', () => {
		const plans: string[][] = []

		/* Explain the queries the lookup actually sends, including their bindings. */
		const tracedDb = drizzle({
			client: sqlite,
			logger: {
				logQuery(query, params) {
					const bindings = v.parse(v.array(v.string()), params)

					const plan = sqlite
						.query<{ detail: string }, string[]>(`EXPLAIN QUERY PLAN ${query}`)
						.all(...bindings)

					plans.push(plan.map(({ detail }) => detail))
				},
			},
		})

		findTermRows(tracedDb, 'kubernetes')

		expect(plans).toHaveLength(2)
		expect(plans[0]).toContain('SEARCH terms USING INDEX terms_term_meaning_idx (term=?)')
		expect(plans[1]).toContain(
			'SEARCH aliases USING COVERING INDEX sqlite_autoindex_aliases_1 (alias=?)',
		)
	})
})
