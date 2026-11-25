// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import type { Database } from 'bun:sqlite'
import { afterEach, beforeEach, describe, expect, it, jest, mock } from 'bun:test'
import { explanationRowFactory } from '#tests/factories/explanations'
import { jobRowFactory } from '#tests/factories/jobs'
import { noteRowFactory } from '#tests/factories/notes'
import { createTestDb, type TestDb } from '#tests/setup/db'
import { eq } from 'drizzle-orm'
import * as v from 'valibot'

import { notes, type NoteStatus } from '#/server/db/schema/notes'
import type { Priority } from '#/server/jobs/queue'

import { maxResearchNowNotes, researchNow, researchNowSchema } from './now'
import type { ResearchPayload } from './pipeline'

describe('researchNow', () => {
	describe('queueing', () => {
		let sqlite: Database
		let db: TestDb
		let enqueue: ReturnType<typeof mock<(payload: ResearchPayload, priority: Priority) => void>>

		beforeEach(async () => {
			jest.useFakeTimers({ now: new Date('2026-11-25T10:00:00Z') })
			;({ sqlite, db } = await createTestDb())
			enqueue = mock(() => {
				// A spec checks what was queued.
			})
		})

		afterEach(() => {
			sqlite.close()
			jest.useRealTimers()
		})

		async function createNote(params: Partial<typeof notes.$inferInsert> = {}) {
			return noteRowFactory.transient({ db }).create(params)
		}

		async function giveCard(noteId: number, params: { isDraft?: boolean; depth?: number } = {}) {
			return explanationRowFactory.transient({ db }).create({ noteId, ...params })
		}

		function statusOf(id: number): NoteStatus | undefined {
			return db.select({ status: notes.status }).from(notes).where(eq(notes.id, id)).get()?.status
		}

		async function createJob(noteId: number, status: 'queued' | 'running') {
			return jobRowFactory
				.transient({ db })
				.create({ kind: 'research', payload: { noteId }, status })
		}

		function run(ids: readonly number[]) {
			return researchNow({ db, enqueue }, ids)
		}

		it('answers not_found for a missing note and a deleted note and queues neither', async () => {
			const deleted = await createNote({ deletedAt: new Date() })

			expect(run([deleted.id, deleted.id + 100])).toEqual([
				{ id: deleted.id, outcome: 'not_found' },
				{ id: deleted.id + 100, outcome: 'not_found' },
			])
			expect(enqueue).not.toHaveBeenCalled()
		})

		it('queues a new note at the now priority and marks it queued', async () => {
			const note = await createNote()

			expect(run([note.id])).toEqual([{ id: note.id, outcome: 'queued' }])
			expect(enqueue).toHaveBeenCalledTimes(1)
			expect(enqueue).toHaveBeenCalledWith({ noteId: note.id, now: true }, 'now')
			expect(statusOf(note.id)).toBe('queued')
		})

		it('queues a failed note', async () => {
			const note = await createNote({ status: 'failed' })

			expect(run([note.id])).toEqual([{ id: note.id, outcome: 'queued' }])
			expect(statusOf(note.id)).toBe('queued')
		})

		it('answers done for a note with a finished card and queues nothing', async () => {
			const note = await createNote({ status: 'ready' })
			await giveCard(note.id)

			expect(run([note.id])).toEqual([{ id: note.id, outcome: 'done' }])
			expect(enqueue).not.toHaveBeenCalled()
			expect(statusOf(note.id)).toBe('ready')
		})

		it('sets an archived note with a card back to ready and answers done', async () => {
			const note = await createNote({ status: 'archived' })
			await giveCard(note.id)

			expect(run([note.id])).toEqual([{ id: note.id, outcome: 'done' }])
			expect(enqueue).not.toHaveBeenCalled()
			expect(statusOf(note.id)).toBe('ready')
		})

		it('queues an archived note without a card and makes it new first', async () => {
			const note = await createNote({ status: 'archived' })

			expect(run([note.id])).toEqual([{ id: note.id, outcome: 'queued' }])
			expect(enqueue).toHaveBeenCalledWith({ noteId: note.id, now: true }, 'now')
			expect(statusOf(note.id)).toBe('queued')
		})

		it('queues a note whose only card is a draft, with no job', async () => {
			const note = await createNote({ status: 'ready' })
			await giveCard(note.id, { isDraft: true })

			expect(run([note.id])).toEqual([{ id: note.id, outcome: 'queued' }])
			expect(enqueue).toHaveBeenCalledTimes(1)
		})

		it('queues a note whose only card is deeper than the first level', async () => {
			const note = await createNote()
			await giveCard(note.id, { depth: 2 })

			expect(run([note.id])).toEqual([{ id: note.id, outcome: 'queued' }])
		})

		it('answers pending for a note with a queued job and for one with a running job', async () => {
			const [waiting, running] = await noteRowFactory.transient({ db }).createList(2)
			await createJob(waiting.id, 'queued')
			await createJob(running.id, 'running')

			expect(run([waiting.id, running.id])).toEqual([
				{ id: waiting.id, outcome: 'pending' },
				{ id: running.id, outcome: 'pending' },
			])
			expect(enqueue).not.toHaveBeenCalled()
		})

		it('keeps request order and answers a duplicate id once with one enqueue', async () => {
			const [first, second, third] = await noteRowFactory.transient({ db }).createList(3)
			const missing = third.id + 100

			expect(run([second.id, missing, first.id, second.id, third.id])).toEqual([
				{ id: second.id, outcome: 'queued' },
				{ id: missing, outcome: 'not_found' },
				{ id: first.id, outcome: 'queued' },
				{ id: third.id, outcome: 'queued' },
			])
			expect(enqueue.mock.calls).toEqual([
				[{ noteId: second.id, now: true }, 'now'],
				[{ noteId: first.id, now: true }, 'now'],
				[{ noteId: third.id, now: true }, 'now'],
			])
		})

		it('returns an array, not a promise, and an empty one for no ids', () => {
			expect(run([])).toEqual([])
			expect(run([])).not.toBeInstanceOf(Promise)
			expect(enqueue).not.toHaveBeenCalled()
		})
	})

	describe('researchNowSchema', () => {
		it('accepts one id and the most it allows', () => {
			const ids = Array.from({ length: maxResearchNowNotes }, (_, index) => index + 1)

			expect(v.safeParse(researchNowSchema, { ids: [1] }).success).toBe(true)
			expect(v.safeParse(researchNowSchema, { ids }).success).toBe(true)
		})

		it.each([
			['no ids', { ids: [] }],
			[
				'101 ids',
				{ ids: Array.from({ length: maxResearchNowNotes + 1 }, (_, index) => index + 1) },
			],
			['zero', { ids: [0] }],
			['a fraction', { ids: [1.5] }],
			['a string id', { ids: ['1'] }],
			['a missing ids', {}],
		])('rejects %s', (_name, body) => {
			expect(v.safeParse(researchNowSchema, body).success).toBe(false)
		})
	})
})
