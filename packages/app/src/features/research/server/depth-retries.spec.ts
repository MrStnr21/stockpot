// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { afterEach, beforeEach, describe, expect, it, jest, spyOn } from 'bun:test'
import { noteRowFactory } from '#tests/factories/notes'
import { storeCard } from '#tests/setup/deeper'
import { advanceBy, advanceTo, jobRows } from '#tests/setup/jobs'
import { limitedUntil, startResearch, type ResearchHarness } from '#tests/setup/research'

import { EngineError } from '#/server/engines/contract'
import { log } from '#/server/log'

const start = new Date('2026-11-20T10:00:00Z')

const inAnHour = new Date('2026-11-20T11:00:00Z')

describe('deeper job retries', () => {
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
		const note = await noteRowFactory.transient({ db: harness.db }).create({ status: 'read' })
		await storeCard(harness.db, { noteId: note.id, depth: 1 })

		return note
	}

	it('requeues a now job at the reset with its priority and writes the level then', async () => {
		const note = await noteWithCard()
		harness.gemini.failure = limitedUntil(inAnHour)
		harness.openAi.failure = limitedUntil(inAnHour)

		await harness.deepen(note.id, 2)

		expect(harness.statusOf(note.id)).toBe('read')
		expect(harness.cardsOf(note.id)).toMatchObject([{ depth: 1 }])
		expect(harness.laterDeeper).toHaveBeenCalledWith(
			{ noteId: note.id, depth: 2, now: true },
			inAnHour,
		)
		expect(jobRows(harness.db)).toMatchObject([
			{ status: 'done', attempts: 1 },
			{ status: 'queued', attempts: 0, priority: 10, runAt: inAnHour },
		])

		harness.gemini.failure = null
		await advanceTo(harness.runner, inAnHour.toISOString())

		expect(harness.cardsOf(note.id)).toMatchObject([{ depth: 1 }, { depth: 2, isDraft: false }])
		expect(jobRows(harness.db)).toMatchObject([{ status: 'done' }, { status: 'done' }])
		expect(harness.notify).toHaveBeenCalledWith({ noteId: note.id })
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

		it('writes no level, names the note and depth in the log, and ends the job without a retry', async () => {
			const note = await noteWithCard()

			await harness.deepen(note.id, 2)

			expect(harness.cardsOf(note.id)).toMatchObject([{ depth: 1 }])
			expect(harness.statusOf(note.id)).toBe('read')
			expect(jobRows(harness.db)).toMatchObject([{ status: 'done', attempts: 1 }])
			expect(warn).toHaveBeenCalledTimes(1)
			expect(warn).toHaveBeenCalledWith(expect.any(String), {
				noteId: note.id,
				depth: 2,
				kind: 'auth',
			})
		})
	})

	it('retries an invalid answer and fails the job after the third attempt, leaving the status', async () => {
		const note = await noteWithCard()

		harness.gemini.failure = new EngineError({ kind: 'invalid', issues: ['steps'] }, note.text)
		await harness.deepen(note.id, 2)
		await advanceBy(harness.runner, 30_000)
		await advanceBy(harness.runner, 60_000)

		expect(harness.gemini.calls).toHaveLength(3)
		expect(harness.cardsOf(note.id)).toMatchObject([{ depth: 1 }])
		expect(harness.statusOf(note.id)).toBe('read')
		expect(jobRows(harness.db)).toMatchObject([
			{ status: 'failed', attempts: 3, lastError: 'The engine failed: invalid' },
		])
	})
})
