// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { afterEach, beforeEach, describe, expect, it, jest, spyOn } from 'bun:test'
import { noteRowFactory } from '#tests/factories/notes'
import { advanceBy, advanceTo, jobRows } from '#tests/setup/jobs'
import { limitedUntil, startResearch, type ResearchHarness } from '#tests/setup/research'

import { EngineError } from '#/server/engines/contract'
import { log } from '#/server/log'

const start = new Date('2026-11-20T10:00:00Z')

const inAnHour = new Date('2026-11-20T11:00:00Z')

describe('research job notify', () => {
	let harness: ResearchHarness

	beforeEach(async () => {
		jest.useFakeTimers({ now: start })
		harness = await startResearch()
	})

	afterEach(async () => {
		await harness.runner.stop()
		jest.useRealTimers()
	})

	it('queues a now job with the flag at priority 10 and a batch job without it at priority 0', async () => {
		const [now, batch] = await noteRowFactory.transient({ db: harness.db }).createList(2)

		harness.queue([now.id], 'now')
		harness.queue([batch.id], 'batch')

		expect(jobRows(harness.db)).toMatchObject([
			{ priority: 10, payload: { noteId: now.id, now: true } },
			{ priority: 0, payload: { noteId: batch.id } },
		])
		expect(jobRows(harness.db)[1]?.payload).toEqual({ noteId: batch.id })
	})

	it('notifies once with the note when a research-now job saves its card', async () => {
		const note = await noteRowFactory.transient({ db: harness.db }).create()

		await harness.research([note.id])

		expect(harness.cardsOf(note.id)).toMatchObject([{ isDraft: false }])
		expect(harness.notify).toHaveBeenCalledTimes(1)
		expect(harness.notify).toHaveBeenCalledWith({ noteId: note.id })
	})

	it('does not notify for a batch job', async () => {
		const note = await noteRowFactory.transient({ db: harness.db }).create()

		harness.queue([note.id], 'batch')
		await advanceBy(harness.runner, 0)

		expect(harness.cardsOf(note.id)).toMatchObject([{ isDraft: false }])
		expect(harness.notify).not.toHaveBeenCalled()
	})

	it('notifies for a draft and not again for the redo that replaces it', async () => {
		const note = await noteRowFactory.transient({ db: harness.db }).create()

		harness.gemini.failure = limitedUntil(inAnHour)
		await harness.research([note.id])

		expect(harness.cardsOf(note.id)).toMatchObject([{ isDraft: true }])
		expect(harness.notify).toHaveBeenCalledTimes(1)
		expect(jobRows(harness.db)).toMatchObject([
			{ status: 'done', priority: 10, payload: { noteId: note.id, now: true } },
			{ status: 'queued', priority: 0, payload: { noteId: note.id }, runAt: inAnHour },
		])

		harness.gemini.failure = null
		await advanceTo(harness.runner, inAnHour.toISOString())

		expect(harness.cardsOf(note.id)).toMatchObject([{ isDraft: false }])
		expect(harness.notify).toHaveBeenCalledTimes(1)
	})

	describe('when every engine is limited', () => {
		it('keeps the now priority across the wait and notifies when the card is saved', async () => {
			const note = await noteRowFactory.transient({ db: harness.db }).create()

			harness.gemini.failure = limitedUntil(inAnHour)
			harness.openAi.failure = limitedUntil(inAnHour)
			await harness.research([note.id])

			expect(harness.cardsOf(note.id)).toEqual([])
			expect(harness.notify).not.toHaveBeenCalled()
			expect(jobRows(harness.db)).toMatchObject([
				{ status: 'done' },
				{ status: 'queued', priority: 10, payload: { noteId: note.id, now: true } },
			])

			harness.gemini.failure = null
			await advanceTo(harness.runner, inAnHour.toISOString())

			expect(harness.cardsOf(note.id)).toMatchObject([{ isDraft: false }])
			expect(harness.notify).toHaveBeenCalledTimes(1)
			expect(harness.notify).toHaveBeenCalledWith({ noteId: note.id })
		})
	})

	it('does not notify for a note whose card is already saved', async () => {
		const note = await noteRowFactory.transient({ db: harness.db }).create()

		await harness.research([note.id])
		await harness.research([note.id])

		expect(harness.cardsOf(note.id)).toHaveLength(1)
		expect(harness.notify).toHaveBeenCalledTimes(1)
	})

	describe('when the engine rejects its key', () => {
		let warn: ReturnType<typeof spyOn<typeof log, 'warn'>>

		beforeEach(() => {
			warn = spyOn(log, 'warn').mockImplementation(() => {
				// Keep the expected warning out of the test log.
			})
		})

		afterEach(() => {
			warn.mockRestore()
		})

		it('does not notify', async () => {
			const note = await noteRowFactory.transient({ db: harness.db }).create()

			harness.gemini.failure = new EngineError({ kind: 'auth' }, 'The key was rejected')
			harness.openAi.failure = new EngineError({ kind: 'auth' }, 'The key was rejected')
			await harness.research([note.id])

			expect(harness.statusOf(note.id)).toBe('failed')
			expect(harness.notify).not.toHaveBeenCalled()
		})
	})

	describe('when notifying throws', () => {
		let warn: ReturnType<typeof spyOn<typeof log, 'warn'>>

		beforeEach(() => {
			warn = spyOn(log, 'warn').mockImplementation(() => {
				// Keep the expected warning out of the test log.
			})
			harness.notify.mockImplementation(() => {
				throw new Error('The sender is down')
			})
		})

		afterEach(() => {
			warn.mockRestore()
		})

		it('keeps the card, finishes the job and logs only the note and the error name', async () => {
			const note = await noteRowFactory.transient({ db: harness.db }).create()

			await harness.research([note.id])

			expect(harness.cardsOf(note.id)).toMatchObject([{ isDraft: false }])
			expect(harness.statusOf(note.id)).toBe('ready')
			expect(jobRows(harness.db)).toMatchObject([{ status: 'done', attempts: 1 }])
			expect(harness.notify).toHaveBeenCalledTimes(1)
			expect(warn).toHaveBeenCalledTimes(1)
			expect(warn).toHaveBeenCalledWith(expect.any(String), { noteId: note.id, name: 'Error' })
		})
	})

	describe('when notifying rejects', () => {
		let warn: ReturnType<typeof spyOn<typeof log, 'warn'>>

		beforeEach(() => {
			warn = spyOn(log, 'warn').mockImplementation(() => {
				// Keep the expected warning out of the test log.
			})
			harness.notify.mockImplementation(async () => {
				throw new Error('The sender is down')
			})
		})

		afterEach(() => {
			warn.mockRestore()
		})

		it('keeps the card, finishes the job and logs the rejection instead of leaving it unhandled', async () => {
			const note = await noteRowFactory.transient({ db: harness.db }).create()

			await harness.research([note.id])
			await Promise.resolve()

			expect(harness.cardsOf(note.id)).toMatchObject([{ isDraft: false }])
			expect(jobRows(harness.db)).toMatchObject([{ status: 'done', attempts: 1 }])
			expect(warn).toHaveBeenCalledTimes(1)
			expect(warn).toHaveBeenCalledWith(expect.any(String), { noteId: note.id, name: 'Error' })
		})
	})
})
