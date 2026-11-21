// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import type { Database } from 'bun:sqlite'
import {
	afterEach,
	beforeEach,
	describe,
	expect,
	it,
	jest,
	mock,
	setSystemTime,
	spyOn,
	type Mock,
} from 'bun:test'
import { explanationRowFactory } from '#tests/factories/explanations'
import { noteRowFactory } from '#tests/factories/notes'
import { createTestDb, type TestDb } from '#tests/setup/db'

import type { JobDefinition, ScheduledRun } from '#/server/jobs/types'
import { log, type Logger } from '#/server/log'

import { createBatchJob } from './batch'

const day = '2026-11-21'

const scheduledAt = new Date(`${day}T06:30:00Z`)

describe('createBatchJob', () => {
	let sqlite: Database
	let db: TestDb
	let pendingIds: Set<number>
	let queue: Mock<(noteIds: readonly number[]) => void>
	let info: Mock<Logger['info']>
	let batch: JobDefinition<ScheduledRun>

	async function runBatch() {
		return batch.run({ day }, { id: 1, attempt: 1, signal: new AbortController().signal })
	}

	beforeEach(async () => {
		;({ sqlite, db } = await createTestDb())
		jest.useFakeTimers({ now: scheduledAt })
		pendingIds = new Set()
		queue = mock((noteIds) => {
			for (const id of noteIds) {
				pendingIds.add(id)
			}
		})
		info = spyOn(log, 'info').mockImplementation(() => {
			// Capture the reported count without writing the test run to stdout.
		})
		batch = createBatchJob({ db, pending: () => pendingIds, queue })
	})

	afterEach(() => {
		info.mockRestore()
		jest.useRealTimers()
		sqlite.close()
	})

	it.each(['new', 'queued', 'researching', 'ready', 'read', 'failed'] as const)(
		'queues a %s note without a finished first card or active research job',
		async (status) => {
			const note = await noteRowFactory.transient({ db }).create({ status })

			await runBatch()

			expect(queue).toHaveBeenCalledWith([note.id])
		},
	)

	it('skips a soft-deleted note', async () => {
		await noteRowFactory.transient({ db }).create({ deletedAt: scheduledAt })

		await runBatch()

		expect(queue).toHaveBeenCalledWith([])
	})

	it('skips an archived note', async () => {
		await noteRowFactory.transient({ db }).create({ status: 'archived' })

		await runBatch()

		expect(queue).toHaveBeenCalledWith([])
	})

	it('skips a note with a finished first card', async () => {
		const [finished, available] = await noteRowFactory.transient({ db }).createList(2)
		await explanationRowFactory
			.transient({ db })
			.create({ noteId: finished.id, depth: 1, isDraft: false })

		await runBatch()

		expect(queue).toHaveBeenCalledWith([available.id])
	})

	it.each([
		{ depth: 1, isDraft: true },
		{ depth: 2, isDraft: false },
	])('queues a note with only a card matching %p', async (card) => {
		const note = await noteRowFactory.transient({ db }).create()
		await explanationRowFactory.transient({ db }).create({ noteId: note.id, ...card })

		await runBatch()

		expect(queue).toHaveBeenCalledWith([note.id])
	})

	it('skips a note with an active research job', async () => {
		const pendingNote = await noteRowFactory.transient({ db }).create()
		const available = await noteRowFactory.transient({ db }).create()
		pendingIds.add(pendingNote.id)

		await runBatch()

		expect(queue).toHaveBeenCalledWith([available.id])
	})

	it('queues synchronously in creation order, breaking ties by id', async () => {
		const factory = noteRowFactory.transient({ db })
		const newest = await factory.create()
		setSystemTime(new Date(`${day}T06:00:00Z`))
		const [oldest, second] = await factory.createList(2)

		const ran = runBatch()

		expect(queue).toHaveBeenCalledWith([oldest.id, second.id, newest.id])
		await ran
	})

	it('queues only the remaining notes on a rerun for the same day', async () => {
		const factory = noteRowFactory.transient({ db })
		const first = await factory.create()
		await runBatch()
		const remaining = await factory.create()

		await runBatch()

		expect(queue.mock.calls).toEqual([[[first.id]], [[remaining.id]]])
	})

	it('logs one line with the scheduled day and queued count', async () => {
		await noteRowFactory.transient({ db }).createList(2)

		await runBatch()

		expect(info.mock.calls).toEqual([['Queued the nightly batch', { day, notes: 2 }]])
	})
})
