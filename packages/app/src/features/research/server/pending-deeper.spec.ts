// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import type { Database } from 'bun:sqlite'
import { afterEach, beforeEach, describe, expect, it, jest } from 'bun:test'
import { jobRowFactory } from '#tests/factories/jobs'
import { createTestDb, type TestDb } from '#tests/setup/db'

import { activeDeeperJobs } from './pending'

describe('activeDeeperJobs', () => {
	let sqlite: Database
	let db: TestDb

	beforeEach(async () => {
		jest.useFakeTimers({ now: new Date('2026-11-18T06:30:00Z') })
		;({ sqlite, db } = await createTestDb())
	})

	afterEach(() => {
		sqlite.close()
		jest.useRealTimers()
	})

	it('lists the payloads of queued and running deeper jobs only', async () => {
		const job = jobRowFactory.transient({ db }).params({ kind: 'deeper' })
		await job.create({ payload: { noteId: 1, depth: 2 }, status: 'queued' })
		await job.create({ payload: { noteId: 2, depth: 3, now: true }, status: 'running' })
		await job.create({ payload: { noteId: 3, depth: 2 }, status: 'done' })
		await job.create({ payload: { noteId: 4, depth: 2 }, status: 'failed' })
		await jobRowFactory
			.transient({ db })
			.create({ kind: 'research', payload: { noteId: 5 }, status: 'queued' })

		expect(activeDeeperJobs(db)).toEqual([
			{ noteId: 1, depth: 2 },
			{ noteId: 2, depth: 3, now: true },
		])
	})

	it('skips payloads that do not parse', async () => {
		const job = jobRowFactory.transient({ db }).params({ kind: 'deeper' })
		await job.create({ payload: [1] })
		await job.create({ payload: { noteId: 1 } })
		await job.create({ payload: { noteId: 1, depth: 1 } })
		await job.create({ payload: { noteId: 1.5, depth: 2 } })
		await job.create({ payload: { noteId: 1, depth: 2, now: false } })
		await job.create({ payload: { noteId: 6, depth: 3 } })

		expect(activeDeeperJobs(db)).toEqual([{ noteId: 6, depth: 3 }])
	})
})
