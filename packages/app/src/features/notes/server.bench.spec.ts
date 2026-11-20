// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { $, nanoseconds } from 'bun'
import type { Database } from 'bun:sqlite'
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { categoryRowFactory } from '#tests/factories/categories'
import { newNoteFactory } from '#tests/factories/notes'
import { migrationsFolder } from '#tests/setup/db'
import * as v from 'valibot'

import { openDatabase, type Db } from '#/server/db/client'

import { createNote, newNoteSchema } from './server'

const saves = 200

/** The nearest-rank percentile of a list of times: the p95 of 200 runs is the 190th fastest. */
function percentile(times: readonly number[], share: number) {
	const sorted = times.toSorted((a, b) => a - b)

	return sorted[Math.ceil(share * sorted.length) - 1] ?? Number.POSITIVE_INFINITY
}

describe('createNote on a database file', () => {
	const folder = join(tmpdir(), `stockpot-save-budget-${crypto.randomUUID()}`)
	let sqlite: Database
	let db: Db
	let times: number[]

	/* The budget is p95 < 50 ms on the server for saving a note (docs/principles.md). A file opened
	 * like the server's, with WAL and synchronous FULL, pays the fsync of every commit, which an
	 * in-memory database would hide. Each save checks a category too, the slower path. */
	beforeAll(async () => {
		await $`mkdir -p ${folder}`.quiet()
		;({ sqlite, db } = await openDatabase({ path: join(folder, 'stockpot.db'), migrationsFolder }))

		const category = await categoryRowFactory.transient({ db }).create()
		const bodies = newNoteFactory.buildList(saves, { categoryId: category.id })

		times = bodies.map((body) => {
			const note = v.parse(newNoteSchema, body)
			const start = nanoseconds()

			createNote(db, note)

			return (nanoseconds() - start) / 1e6
		})
	})

	afterAll(async () => {
		sqlite.close()
		await $`rm -rf ${folder}`.quiet()
	})

	it(`saves ${saves} notes with a p95 under 50 ms`, () => {
		expect(percentile(times, 0.95)).toBeLessThan(50)
	})
})
