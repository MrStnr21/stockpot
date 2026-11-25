// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { afterEach, beforeEach, describe, expect, it, jest } from 'bun:test'
import { noteRowFactory } from '#tests/factories/notes'
import { storeCard } from '#tests/setup/deeper'
import { advanceTo, jobRows } from '#tests/setup/jobs'
import { limitedUntil, startResearch, type ResearchHarness } from '#tests/setup/research'
import { eq } from 'drizzle-orm'

import { notes } from '#/server/db/schema/notes'

const start = new Date('2026-11-20T10:00:00Z')

const inAnHour = new Date('2026-11-20T11:00:00Z')

describe('deeper job saving', () => {
	let harness: ResearchHarness

	beforeEach(async () => {
		jest.useFakeTimers({ now: start })
		harness = await startResearch()
	})

	afterEach(async () => {
		await harness.runner.stop()
		jest.useRealTimers()
	})

	async function noteWithCard() {
		return noteRowFactory.transient({ db: harness.db }).create({ status: 'read' })
	}

	function depthsOf(noteId: number) {
		return harness.cardsOf(noteId).map(({ depth }) => depth)
	}

	describe('a draft from a fallback engine', () => {
		it('is replaced at the reset by a finished card, without flipping the status again', async () => {
			const note = await noteWithCard()
			await storeCard(harness.db, { noteId: note.id, depth: 1 })
			harness.gemini.failure = limitedUntil(inAnHour)

			await harness.deepen(note.id, 2)

			expect(harness.cardsOf(note.id)).toMatchObject([
				{ depth: 1 },
				{ depth: 2, engine: 'openai-compatible', isDraft: true },
			])
			expect(harness.statusOf(note.id)).toBe('ready')
			expect(harness.laterDeeper).toHaveBeenCalledWith({ noteId: note.id, depth: 2 }, inAnHour)
			expect(jobRows(harness.db)).toMatchObject([
				{ status: 'done', priority: 10 },
				{ status: 'queued', priority: 0, payload: { noteId: note.id, depth: 2 }, runAt: inAnHour },
			])
			expect(jobRows(harness.db)[1]?.payload).toEqual({ noteId: note.id, depth: 2 })

			// The owner read the draft before the redo came.
			harness.db.update(notes).set({ status: 'read' }).where(eq(notes.id, note.id)).run()
			harness.gemini.failure = null
			await advanceTo(harness.runner, inAnHour.toISOString())

			expect(harness.cardsOf(note.id)).toMatchObject([
				{ depth: 1 },
				{ depth: 2, engine: 'gemini', isDraft: false },
			])
			expect(harness.statusOf(note.id)).toBe('read')
			expect(harness.notify).toHaveBeenCalledTimes(1)
		})
	})

	it('keeps the finished card that another job saved during the call', async () => {
		const note = await noteWithCard()
		await storeCard(harness.db, { noteId: note.id, depth: 1 })
		const rival = { engine: 'rival', depth: 2 }

		harness.gemini.during = async () => {
			await storeCard(harness.db, { noteId: note.id, depth: 2, engine: 'rival' })
		}

		await harness.deepen(note.id, 2)

		expect(harness.cardsOf(note.id)).toMatchObject([{ depth: 1 }, rival])
		expect(harness.notify).not.toHaveBeenCalled()
	})

	describe('notifying', () => {
		it('notifies once with the note when a now job saves its level', async () => {
			const note = await noteWithCard()
			await storeCard(harness.db, { noteId: note.id, depth: 1 })

			await harness.deepen(note.id, 2, 'now')

			expect(harness.notify).toHaveBeenCalledTimes(1)
			expect(harness.notify).toHaveBeenCalledWith({ noteId: note.id })
		})

		it('does not notify for a batch job', async () => {
			const note = await noteWithCard()
			await storeCard(harness.db, { noteId: note.id, depth: 1 })

			await harness.deepen(note.id, 2, 'batch')

			expect(depthsOf(note.id)).toEqual([1, 2])
			expect(harness.notify).not.toHaveBeenCalled()
		})
	})
})
