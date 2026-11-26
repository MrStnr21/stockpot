// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import type { Database } from 'bun:sqlite'
import { afterAll, beforeAll, describe, expect, it, jest } from 'bun:test'
import { faker } from '@faker-js/faker'
import { jobRowFactory } from '#tests/factories/jobs'
import { createTestDb, type TestDb } from '#tests/setup/db'
import { sql } from 'drizzle-orm'

import {
	activeJobPayloads,
	jobsOfKinds,
	newestJobForNote,
	nextDueJob,
	selectJobsOfKinds,
	selectNewestJobForNote,
} from './queue'

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
	describe('jobsOfKinds', () => {
		it('finds the rows through jobs_queue_idx by status', () => {
			const query = selectJobsOfKinds(db, ['research', 'deeper'], ['queued', 'running']).getSQL()
			const plan = db.all<{ detail: string }>(sql`EXPLAIN QUERY PLAN ${query}`)

			expect(plan.map(({ detail }) => detail)).toEqual([
				'SEARCH jobs USING INDEX jobs_queue_idx (status=?)',
			])
		})

		it('returns the jobs of the requested kinds and statuses only', async () => {
			const kind = `${faker.word.verb()}-${faker.string.alphanumeric(6)}`
			const other = `${kind}-other`
			const job = jobRowFactory.transient({ db })

			const queued = await job.create({ kind, status: 'queued', payload: { noteId: 1 } })
			const failed = await job.create({ kind: other, status: 'failed', lastError: 'Boom' })
			await job.create({ kind, status: 'done' })
			await job.create({ kind: `${kind}-later`, status: 'queued' })

			const found = jobsOfKinds(db, [kind, other], ['queued', 'failed'])

			expect(found.map(({ id }) => id).toSorted((a, b) => a - b)).toEqual(
				[queued.id, failed.id].toSorted((a, b) => a - b),
			)
			expect(found.find(({ id }) => id === failed.id)).toMatchObject({
				kind: other,
				status: 'failed',
				lastError: 'Boom',
				attempts: 0,
				finishedAt: null,
			})
		})

		it('returns nothing for no kinds or no statuses', () => {
			expect(jobsOfKinds(db, [], ['queued'])).toEqual([])
			expect(jobsOfKinds(db, ['research'], [])).toEqual([])
		})
	})

	describe('newestJobForNote', () => {
		it('reads the table backwards by id and stops at the first match, without a sort', () => {
			const query = selectNewestJobForNote(db, 'research', 1).getSQL()
			const plan = db.all<{ detail: string }>(sql`EXPLAIN QUERY PLAN ${query}`)

			expect(plan.map(({ detail }) => detail)).toEqual(['SCAN jobs'])
		})

		it('returns the newest job of the kind for the note, whatever its status', async () => {
			const kind = `${faker.word.verb()}-${faker.string.alphanumeric(6)}`
			const noteId = faker.number.int({ min: 1, max: 1_000_000 })
			const job = jobRowFactory.transient({ db }).params({ kind })

			await job.create({ payload: { noteId }, status: 'failed' })
			const newest = await job.create({ payload: { noteId }, status: 'done' })
			await job.create({ payload: { noteId: noteId + 1 }, status: 'failed' })
			await job.create({ kind: `${kind}-other`, payload: { noteId }, status: 'failed' })

			expect(newestJobForNote(db, kind, noteId)).toMatchObject({ id: newest.id, status: 'done' })
			expect(newestJobForNote(db, kind, noteId + 2)).toBeUndefined()
		})
	})
})
