// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import type { Database } from 'bun:sqlite'
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { createTestDb, type TestDb } from '#tests/setup/db'
import { sql } from 'drizzle-orm'

import { nextDueJob } from './queue'

describe('nextDueJob', () => {
	let sqlite: Database
	let db: TestDb

	beforeAll(async () => {
		;({ sqlite, db } = await createTestDb())
	})

	afterAll(() => {
		sqlite.close()
	})

	it('reads the queue through jobs_queue_idx without a sort', () => {
		const query = nextDueJob(db, new Date()).getSQL()
		const plan = db.all<{ detail: string }>(sql`EXPLAIN QUERY PLAN ${query}`)

		expect(plan.map(({ detail }) => detail)).toEqual([
			'SEARCH jobs USING COVERING INDEX jobs_queue_idx (status=?)',
		])
	})
})
