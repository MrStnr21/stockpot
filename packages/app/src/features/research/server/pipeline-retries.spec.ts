// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { drainMicrotasks } from 'bun:jsc'
import { afterEach, beforeEach, describe, expect, it, jest } from 'bun:test'
import { noteRowFactory } from '#tests/factories/notes'
import { advanceBy, advanceTo, jobRows } from '#tests/setup/jobs'
import { limitedUntil, startResearch, type ResearchHarness } from '#tests/setup/research'

import { EngineError } from '#/server/engines/contract'

const start = new Date('2026-11-20T10:00:00Z')

const inAnHour = new Date('2026-11-20T11:00:00Z')

describe('research retries', () => {
	let harness: ResearchHarness

	beforeEach(async () => {
		jest.useFakeTimers({ now: start })
		harness = await startResearch()
	})

	afterEach(async () => {
		await harness.runner.stop()
		jest.useRealTimers()
	})

	describe('when every engine is limited', () => {
		beforeEach(() => {
			harness.gemini.failure = limitedUntil(inAnHour)
			harness.openAi.failure = limitedUntil(inAnHour)
		})

		it('requeues the note at the reset without spending an attempt', async () => {
			const note = await noteRowFactory.transient({ db: harness.db }).create()

			await harness.research([note.id])

			expect(harness.statusOf(note.id)).toBe('queued')
			expect(harness.later).toHaveBeenCalledWith({ noteId: note.id, now: true }, inAnHour)
			expect(jobRows(harness.db)).toMatchObject([
				{ status: 'done', attempts: 1 },
				{ status: 'queued', attempts: 0, runAt: inAnHour },
			])

			harness.gemini.failure = null
			await advanceTo(harness.runner, inAnHour.toISOString())

			expect(harness.statusOf(note.id)).toBe('ready')
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

			expect(harness.later).toHaveBeenCalledWith(
				{ noteId: note.id, now: true },
				new Date(calledAt + 60_000),
			)
		})

		it('retries a failed requeue and fails the note on the final attempt', async () => {
			const note = await noteRowFactory.transient({ db: harness.db }).create()
			harness.later.mockImplementation(() => {
				throw new Error('The database is locked')
			})

			await harness.research([note.id])
			expect(harness.statusOf(note.id)).toBe('queued')
			expect(jobRows(harness.db)).toMatchObject([
				{ status: 'queued', lastError: 'The database is locked' },
			])
			await advanceBy(harness.runner, 30_000)
			await advanceBy(harness.runner, 60_000)

			expect(harness.statusOf(note.id)).toBe('failed')
			expect(jobRows(harness.db)).toMatchObject([
				{ status: 'failed', attempts: 3, lastError: 'The database is locked' },
			])
		})
	})

	it('retries an invalid answer and fails the note after the third attempt', async () => {
		const note = await noteRowFactory.transient({ db: harness.db }).create()
		const statuses: unknown[] = []

		harness.gemini.failure = new EngineError({ kind: 'invalid', issues: ['sense'] }, note.text)
		await harness.research([note.id])
		statuses.push(harness.statusOf(note.id))
		await advanceBy(harness.runner, 30_000)
		statuses.push(harness.statusOf(note.id))
		await advanceBy(harness.runner, 60_000)
		statuses.push(harness.statusOf(note.id))

		expect(statuses).toEqual(['queued', 'queued', 'failed'])
		expect(harness.gemini.calls).toHaveLength(3)
		expect(jobRows(harness.db)).toMatchObject([
			{ status: 'failed', attempts: 3, lastError: 'The engine failed: invalid' },
		])
	})

	describe('when the engine ignores the timeout', () => {
		let held: PromiseWithResolvers<null>

		beforeEach(() => {
			held = Promise.withResolvers<null>()
		})

		function releaseAnswer() {
			held.resolve(null)
			drainMicrotasks()
			expect(harness.gemini.answers).toHaveLength(1)
		}

		it('fails the note before the last attempt answers and discards its late card', async () => {
			const note = await noteRowFactory.transient({ db: harness.db }).create()
			harness.gemini.failure = new Error('The engine is unavailable')
			await harness.research([note.id])
			await advanceBy(harness.runner, 30_000)

			harness.gemini.failure = null
			harness.gemini.during = async () => {
				await held.promise
			}

			jest.advanceTimersByTime(60_000)
			await advanceBy(harness.runner, 16 * 60_000)

			expect(jobRows(harness.db)).toMatchObject([{ status: 'failed', attempts: 3 }])
			expect(harness.statusOf(note.id)).toBe('failed')
			releaseAnswer()
			expect(harness.cardsOf(note.id)).toEqual([])
			expect(harness.statusOf(note.id)).toBe('failed')
		})

		it('discards the first answer when it arrives after attempts two and three failed', async () => {
			const note = await noteRowFactory.transient({ db: harness.db }).create()
			harness.gemini.during = async () => {
				await held.promise
			}

			harness.queue([note.id])
			jest.advanceTimersByTime(0)
			await advanceBy(harness.runner, 16 * 60_000)

			harness.gemini.during = () => {
				throw new Error('The engine is unavailable')
			}

			await advanceBy(harness.runner, 30_000)
			await advanceBy(harness.runner, 60_000)
			expect(jobRows(harness.db)).toMatchObject([{ status: 'failed', attempts: 3 }])

			releaseAnswer()
			expect(harness.cardsOf(note.id)).toEqual([])
			expect(harness.statusOf(note.id)).toBe('failed')
		})
	})
})
