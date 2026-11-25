// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import type { Database } from 'bun:sqlite'
import { afterAll, beforeAll, describe, expect, it, jest } from 'bun:test'
import { faker } from '@faker-js/faker'
import { jobRowFactory } from '#tests/factories/jobs'
import { createTestDb, type TestDb } from '#tests/setup/db'
import { sql } from 'drizzle-orm'

import { activeJobPayloads, nextDueJob } from './queue'

describe('queue', () => {
	let sqlite: Database
	let db: TestDb

	beforeAll(async () => {
		;({ sqlite, db } = await createTestDb())
	})

	afterAll(() => {
		sqlite.close()
	})

	describe('nextDueJob', () => {
		it('reads the queue through jobs_queue_idx without a sort', () => {
			const query = nextDueJob(db, new Date('2026-11-18T06:30:00Z')).getSQL()
			const plan = db.all<{ detail: string }>(sql`EXPLAIN QUERY PLAN ${query}`)

			expect(plan.map(({ detail }) => detail)).toEqual([
				'SEARCH jobs USING COVERING INDEX jobs_queue_idx (status=?)',
			])
		})
	})

	describe('activeJobPayloads', () => {
		beforeAll(() => {
			jest.useFakeTimers({ now: new Date('2026-11-18T06:30:00Z') })
		})

		afterAll(() => {
			jest.useRealTimers()
		})

		it('returns payloads of queued and running jobs of the requested kind', async () => {
			const kind = faker.word.verb()
			const job = jobRowFactory.transient({ db }).params({ kind })

			const queued = await job.create({
				payload: { name: faker.word.noun() },
				status: 'queued',
				runAt: new Date('2026-11-18T07:30:00Z'),
			})

			const running = await job.create({ payload: faker.word.noun(), status: 'running' })
			await job.create({ status: 'done' })
			await job.create({ status: 'failed' })
			await job.create({ kind: `${kind}-later`, status: 'queued' })

			const payloads = activeJobPayloads(db, kind)

			expect(payloads).toHaveLength(2)
			expect(payloads).toContainEqual(queued.payload)
			expect(payloads).toContainEqual(running.payload)
		})
	})
})
