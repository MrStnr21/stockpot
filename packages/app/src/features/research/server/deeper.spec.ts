// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import type { Database } from 'bun:sqlite'
import { afterEach, beforeEach, describe, expect, it, jest, mock, type Mock } from 'bun:test'
import { faker } from '@faker-js/faker'
import { jobRowFactory } from '#tests/factories/jobs'
import { noteRowFactory } from '#tests/factories/notes'
import { createTestDb, type TestDb } from '#tests/setup/db'
import { storeCard } from '#tests/setup/deeper'
import { eq } from 'drizzle-orm'

import { notes } from '#/server/db/schema/notes'
import type { Priority } from '#/server/jobs/queue'

import { requestDeeper } from './deeper'
import type { DeeperPayload } from './depth'

describe('requestDeeper', () => {
	let sqlite: Database
	let db: TestDb
	let enqueue: Mock<(payload: DeeperPayload, priority: Priority) => void>

	beforeEach(async () => {
		jest.useFakeTimers({ now: new Date('2026-11-21T06:00:00Z') })
		;({ sqlite, db } = await createTestDb())
		enqueue = mock(() => {
			// A spec reads the calls.
		})
	})

	afterEach(() => {
		sqlite.close()
		jest.useRealTimers()
	})

	async function noteWithCards(
		depths: (1 | 2 | 3)[],
		overrides: Partial<typeof notes.$inferInsert> = {},
	) {
		const note = await noteRowFactory.transient({ db }).create({ status: 'read', ...overrides })

		await Promise.all(depths.map(async (depth) => storeCard(db, { noteId: note.id, depth })))

		return note.id
	}

	async function queuedJob(
		payload: DeeperPayload,
		status: 'queued' | 'running' | 'done' | 'failed',
	) {
		return jobRowFactory.transient({ db }).create({ kind: 'deeper', payload, status })
	}

	function request(noteId: number, now = false) {
		return requestDeeper({ db, enqueue }, noteId, { now })
	}

	function statusOf(id: number) {
		return db.select({ status: notes.status }).from(notes).where(eq(notes.id, id)).get()?.status
	}

	describe('the outcomes', () => {
		it('finds no such note for a missing or a deleted one', async () => {
			const deleted = await noteWithCards([1], { deletedAt: faker.date.past() })

			expect(request(deleted + 100)).toEqual({
				id: deleted + 100,
				outcome: 'not_found',
				depth: null,
			})
			expect(request(deleted)).toEqual({ id: deleted, outcome: 'not_found', depth: null })
			expect(enqueue).not.toHaveBeenCalled()
		})

		it('finds no card for a note without a first level, whatever else it has', async () => {
			const bare = await noteWithCards([])
			const skipped = await noteWithCards([2])

			expect(request(bare)).toEqual({ id: bare, outcome: 'no_card', depth: null })
			expect(request(skipped)).toEqual({ id: skipped, outcome: 'no_card', depth: null })
			expect(enqueue).not.toHaveBeenCalled()
		})

		it('finds the deepest level written when level 3 exists', async () => {
			const id = await noteWithCards([1, 2, 3])

			expect(request(id, true)).toEqual({ id, outcome: 'deepest', depth: 3 })
			expect(enqueue).not.toHaveBeenCalled()
		})

		it('queues level 2 for the batch after a finished level 1', async () => {
			const id = await noteWithCards([1])

			expect(request(id)).toEqual({ id, outcome: 'queued', depth: 2 })
			expect(enqueue).toHaveBeenCalledTimes(1)
			expect(enqueue).toHaveBeenCalledWith({ noteId: id, depth: 2 }, 'batch')
			expect(enqueue.mock.calls[0]?.[0]).toEqual({ noteId: id, depth: 2 })
		})

		it('queues level 2 after a draft level 1 as well', async () => {
			const note = await noteRowFactory.transient({ db }).create({ status: 'read' })
			await storeCard(db, { noteId: note.id, depth: 1, isDraft: true })

			expect(request(note.id)).toEqual({ id: note.id, outcome: 'queued', depth: 2 })
		})

		it('queues level 3 after level 2, and a now request at the now priority', async () => {
			const id = await noteWithCards([1, 2])

			expect(request(id, true)).toEqual({ id, outcome: 'queued', depth: 3 })
			expect(enqueue).toHaveBeenCalledWith({ noteId: id, depth: 3, now: true }, 'now')
		})

		it('answers at once, with an object and not a promise', async () => {
			const id = await noteWithCards([1])

			expect(request(id)).not.toBeInstanceOf(Promise)
		})
	})

	describe('a job that is queued already', () => {
		it('covers a batch request, whether it is queued or running', async () => {
			const queued = await noteWithCards([1])
			const running = await noteWithCards([1])
			await queuedJob({ noteId: queued, depth: 2 }, 'queued')
			await queuedJob({ noteId: running, depth: 2 }, 'running')

			expect(request(queued)).toEqual({ id: queued, outcome: 'pending', depth: 2 })
			expect(request(running)).toEqual({ id: running, outcome: 'pending', depth: 2 })
			expect(enqueue).not.toHaveBeenCalled()
		})

		it('does not cover a now request: a second, now job is queued', async () => {
			const id = await noteWithCards([1])
			await queuedJob({ noteId: id, depth: 2 }, 'queued')

			expect(request(id, true)).toEqual({ id, outcome: 'queued', depth: 2 })
			expect(enqueue).toHaveBeenCalledWith({ noteId: id, depth: 2, now: true }, 'now')
		})

		it('covers both kinds of request when it is a now job', async () => {
			const id = await noteWithCards([1])
			await queuedJob({ noteId: id, depth: 2, now: true }, 'queued')

			expect(request(id).outcome).toBe('pending')
			expect(request(id, true).outcome).toBe('pending')
			expect(enqueue).not.toHaveBeenCalled()
		})

		it('ignores jobs for another note or level, and jobs that are done or failed', async () => {
			const id = await noteWithCards([1])
			const other = await noteWithCards([1])
			await queuedJob({ noteId: other, depth: 2 }, 'queued')
			await queuedJob({ noteId: id, depth: 3 }, 'queued')
			await queuedJob({ noteId: id, depth: 2 }, 'done')
			await queuedJob({ noteId: id, depth: 2, now: true }, 'failed')

			expect(request(id)).toEqual({ id, outcome: 'queued', depth: 2 })
		})
	})

	describe('an archived note', () => {
		it('becomes ready when it has a card, and the request is queued', async () => {
			const id = await noteWithCards([1], { status: 'archived' })

			expect(request(id).outcome).toBe('queued')
			expect(statusOf(id)).toBe('ready')
		})

		it('stays archived without a card', async () => {
			const id = await noteWithCards([], { status: 'archived' })

			expect(request(id).outcome).toBe('no_card')
			expect(statusOf(id)).toBe('archived')
		})
	})

	it('leaves the status of a read note alone', async () => {
		const id = await noteWithCards([1])

		request(id)

		expect(statusOf(id)).toBe('read')
	})
})
