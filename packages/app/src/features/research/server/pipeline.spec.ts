// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { afterEach, beforeEach, describe, expect, it, jest, spyOn } from 'bun:test'
import { faker } from '@faker-js/faker'
import { categoryRowFactory } from '#tests/factories/categories'
import { noteRowFactory } from '#tests/factories/notes'
import { termRowFactory } from '#tests/factories/terms'
import { advanceBy, advanceTo, jobRows } from '#tests/setup/jobs'
import { limitedUntil, startResearch, type ResearchHarness } from '#tests/setup/research'
import { asc, eq } from 'drizzle-orm'

import { explanations } from '#/server/db/schema/explanations'
import { notes } from '#/server/db/schema/notes'
import { EngineError } from '#/server/engines/contract'
import { log } from '#/server/log'

const start = new Date('2026-11-20T10:00:00Z')

const inAnHour = new Date('2026-11-20T11:00:00Z')

describe('research job', () => {
	let harness: ResearchHarness

	beforeEach(async () => {
		jest.useFakeTimers({ now: start })
		harness = await startResearch()
	})

	afterEach(async () => {
		await harness.runner.stop()
		jest.useRealTimers()
	})

	function statusOf(noteId: number) {
		const { db } = harness

		return db.select({ status: notes.status }).from(notes).where(eq(notes.id, noteId)).get()?.status
	}

	function cardsOf(noteId: number) {
		const { db } = harness

		return db
			.select()
			.from(explanations)
			.where(eq(explanations.noteId, noteId))
			.orderBy(asc(explanations.id))
			.all()
	}

	it('takes a queued note through researching to ready with one card and one call', async () => {
		const note = await noteRowFactory.transient({ db: harness.db }).create()
		const seen: unknown[] = []

		harness.gemini.during = () => {
			seen.push(statusOf(note.id))
		}

		harness.queue([note.id])
		seen.unshift(statusOf(note.id))
		await advanceBy(harness.runner, 0)

		expect([...seen, statusOf(note.id)]).toEqual(['queued', 'researching', 'ready'])
		expect(harness.gemini.calls).toMatchObject([{ method: 'explain' }])
		expect(cardsOf(note.id)).toMatchObject([{ engine: 'gemini', depth: 1, isDraft: false }])
		expect(jobRows(harness.db)).toMatchObject([{ status: 'done', attempts: 1 }])
	})

	it('sends only the term of a private note', async () => {
		const term = await termRowFactory.transient({ db: harness.db }).create()

		const note = await noteRowFactory.transient({ db: harness.db }).create({
			termId: term.id,
			text: faker.lorem.sentence(),
			url: faker.internet.url(),
			isPrivate: true,
		})

		await harness.research([note.id])

		const [call] = harness.gemini.calls
		const received = JSON.stringify(call.input)

		expect(call.input).toMatchObject({
			note: { term: term.term, text: null, context: null, url: null, isPrivate: true },
			previous: [],
		})
		expect(
			[note.text, note.context, note.url].filter((value) => received.includes(`${value}`)),
		).toEqual([])
		expect(statusOf(note.id)).toBe('ready')
	})

	it('writes a report through the research task', async () => {
		const category = await categoryRowFactory.transient({ db: harness.db }).create({
			format: 'report',
		})

		const note = await noteRowFactory.transient({ db: harness.db }).create({
			categoryId: category.id,
		})

		await harness.research([note.id])

		expect(harness.gemini.calls).toMatchObject([{ method: 'research', tier: 'deep' }])
		expect(cardsOf(note.id)).toMatchObject([{ format: 'report', isDraft: false }])
	})

	it('stores a draft while the primary engine is limited and replaces it at the reset', async () => {
		const note = await noteRowFactory.transient({ db: harness.db }).create()

		harness.gemini.failure = limitedUntil(inAnHour)
		await harness.research([note.id])

		expect(cardsOf(note.id)).toMatchObject([{ engine: 'openai-compatible', isDraft: true }])
		expect(statusOf(note.id)).toBe('ready')
		expect(harness.later).toHaveBeenCalledWith({ noteId: note.id }, inAnHour)

		harness.gemini.failure = null
		await advanceTo(harness.runner, inAnHour.toISOString())

		expect(cardsOf(note.id)).toMatchObject([{ engine: 'gemini', isDraft: false }])
		expect(statusOf(note.id)).toBe('ready')
		expect(harness.openAi.calls).toHaveLength(1)
	})

	describe('when every engine is limited', () => {
		beforeEach(() => {
			harness.gemini.failure = limitedUntil(inAnHour)
			harness.openAi.failure = limitedUntil(inAnHour)
		})

		it('requeues the note at the reset without spending an attempt', async () => {
			const note = await noteRowFactory.transient({ db: harness.db }).create()

			await harness.research([note.id])

			expect(statusOf(note.id)).toBe('queued')
			expect(harness.later).toHaveBeenCalledWith({ noteId: note.id }, inAnHour)
			expect(jobRows(harness.db)).toMatchObject([
				{ status: 'done', attempts: 1 },
				{ status: 'queued', attempts: 0, runAt: inAnHour },
			])

			harness.gemini.failure = null
			await advanceTo(harness.runner, inAnHour.toISOString())

			expect(statusOf(note.id)).toBe('ready')
			expect(jobRows(harness.db)).toMatchObject([{ status: 'done' }, { status: 'done' }])
		})

		it('waits at least a minute for a reset that is about to pass', async () => {
			const note = await noteRowFactory.transient({ db: harness.db }).create()
			const soon = new Date(start.getTime() + 5000)
			let calledAt = 0

			harness.gemini.failure = limitedUntil(soon)
			harness.openAi.failure = limitedUntil(soon)
			harness.gemini.during = () => {
				calledAt = Date.now()
			}

			await harness.research([note.id])

			expect(harness.later).toHaveBeenCalledWith({ noteId: note.id }, new Date(calledAt + 60_000))
		})
	})

	describe('when every engine rejects its key', () => {
		let warn: ReturnType<typeof spyOn<typeof log, 'warn'>>

		beforeEach(() => {
			warn = spyOn(log, 'warn').mockImplementation(() => {
				// Keep the expected warnings out of the test log.
			})
			harness.gemini.failure = new EngineError({ kind: 'auth' }, 'The key was rejected')
			harness.openAi.failure = new EngineError({ kind: 'auth' }, 'The key was rejected')
		})

		afterEach(() => {
			warn.mockRestore()
		})

		it('fails the note at once and names it in the log', async () => {
			const note = await noteRowFactory.transient({ db: harness.db }).create()

			await harness.research([note.id])

			expect(statusOf(note.id)).toBe('failed')
			expect(jobRows(harness.db)).toMatchObject([{ status: 'done', attempts: 1 }])
			expect(warn).toHaveBeenCalledWith(expect.any(String), { noteId: note.id, kind: 'auth' })
		})
	})

	it('retries an invalid answer and fails the note after the third attempt', async () => {
		const note = await noteRowFactory.transient({ db: harness.db }).create()
		const statuses: unknown[] = []

		harness.gemini.failure = new EngineError({ kind: 'invalid', issues: ['sense'] }, 'Invalid')
		await harness.research([note.id])
		statuses.push(statusOf(note.id))
		await advanceBy(harness.runner, 30_000)
		statuses.push(statusOf(note.id))
		await advanceBy(harness.runner, 60_000)
		statuses.push(statusOf(note.id))

		expect(statuses).toEqual(['queued', 'queued', 'failed'])
		expect(harness.gemini.calls).toHaveLength(3)
		expect(jobRows(harness.db)).toMatchObject([{ status: 'failed', attempts: 3 }])
	})

	describe('learning', () => {
		let warn: ReturnType<typeof spyOn<typeof log, 'warn'>>

		beforeEach(() => {
			warn = spyOn(log, 'warn').mockImplementation(() => {
				// Keep the expected warnings out of the test log.
			})
		})

		afterEach(() => {
			warn.mockRestore()
		})

		it("learns the card's sense and aliases for the note's term", async () => {
			const term = await termRowFactory.transient({ db: harness.db }).create()
			const note = await noteRowFactory.transient({ db: harness.db }).create({ termId: term.id })

			await harness.research([note.id])

			const [{ sense, aliases } = { sense: '', aliases: [] }] = harness.gemini.answers

			expect(harness.learn).toHaveBeenCalledWith(term.id, { sense, aliases })
		})

		it('learns nothing for a note without a term', async () => {
			const note = await noteRowFactory.transient({ db: harness.db }).create()

			await harness.research([note.id])

			expect(harness.learn).not.toHaveBeenCalled()
			expect(statusOf(note.id)).toBe('ready')
		})

		it('logs a failed learning step and keeps the card', async () => {
			const term = await termRowFactory.transient({ db: harness.db }).create()
			const note = await noteRowFactory.transient({ db: harness.db }).create({ termId: term.id })

			harness.learn.mockImplementation(() => {
				throw new Error('The database is locked')
			})
			await harness.research([note.id])

			expect(statusOf(note.id)).toBe('ready')
			expect(cardsOf(note.id)).toHaveLength(1)
			expect(jobRows(harness.db)).toMatchObject([{ status: 'done' }])
			expect(warn).toHaveBeenCalledWith(expect.any(String), {
				noteId: note.id,
				termId: term.id,
				name: 'Error',
			})
		})
	})

	it('makes no call for a deleted note', async () => {
		const note = await noteRowFactory.transient({ db: harness.db }).create({
			deletedAt: faker.date.past(),
		})

		await harness.research([note.id])

		expect(harness.gemini.calls).toEqual([])
		expect(cardsOf(note.id)).toEqual([])
		expect(jobRows(harness.db)).toMatchObject([{ status: 'done' }])
	})

	it('marks only live new and failed notes as queued, with a job for each', async () => {
		const captures = noteRowFactory.transient({ db: harness.db })
		const fresh = await captures.create()
		const failed = await captures.create({ status: 'failed' })
		const read = await captures.create({ status: 'read' })
		const deleted = await captures.create({ deletedAt: faker.date.past() })
		const ids = [fresh.id, failed.id, read.id, deleted.id]

		harness.queue(ids, 'batch')

		expect(ids.map((id) => statusOf(id))).toEqual(['queued', 'queued', 'read', 'new'])
		expect(jobRows(harness.db)).toMatchObject(
			ids.map((noteId) => ({ kind: 'research', status: 'queued', payload: { noteId } })),
		)
	})
})
