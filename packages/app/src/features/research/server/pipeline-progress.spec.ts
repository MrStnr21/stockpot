// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { drainMicrotasks } from 'bun:jsc'
import { afterEach, beforeEach, describe, expect, it, jest } from 'bun:test'
import { categoryRowFactory } from '#tests/factories/categories'
import { noteRowFactory } from '#tests/factories/notes'
import { advanceBy } from '#tests/setup/jobs'
import { limitedUntil, startResearch, type ResearchHarness } from '#tests/setup/research'

import type { ResearchProgress, RunOptions } from '#/server/engines/contract'

import { createProgressBoard, type ProgressBoard } from './ideas'

const start = new Date('2026-11-20T10:00:00Z')

const searching: ResearchProgress = { step: 'searching', questions: 3, searched: 1, pages: 4 }

const writing: ResearchProgress = { step: 'writing', questions: 3, searched: 3, pages: 9 }

describe('research job progress', () => {
	let harness: ResearchHarness
	let board: ProgressBoard

	async function ideaNote() {
		const category = await categoryRowFactory.transient({ db: harness.db }).create({
			format: 'report',
		})

		return noteRowFactory.transient({ db: harness.db }).create({ categoryId: category.id })
	}

	beforeEach(async () => {
		jest.useFakeTimers({ now: start })
		board = createProgressBoard()
		harness = await startResearch(board)
	})

	afterEach(async () => {
		await harness.runner.stop()
		jest.useRealTimers()
	})

	it('shows the engine progress while it runs and clears it after the card is saved', async () => {
		const note = await ideaNote()
		const seen: (ResearchProgress | null)[] = []

		harness.gemini.during = ({ onProgress }) => {
			onProgress?.(searching)
			seen.push(board.get(note.id))
		}

		await harness.research([note.id])

		expect(seen).toEqual([searching])
		expect(harness.cardsOf(note.id)).toHaveLength(1)
		expect(board.get(note.id)).toBeNull()
	})

	it('clears it when the engine throws', async () => {
		const note = await ideaNote()

		harness.gemini.during = ({ onProgress }) => {
			onProgress?.(writing)
			throw new Error('The engine is unavailable')
		}

		await harness.research([note.id])

		expect(harness.statusOf(note.id)).toBe('queued')
		expect(board.get(note.id)).toBeNull()
	})

	it('clears it when the job waits for an engine to reset', async () => {
		const note = await ideaNote()

		harness.gemini.during = ({ onProgress }) => {
			onProgress?.(writing)
			throw limitedUntil(new Date('2026-11-20T11:00:00Z'))
		}

		await harness.research([note.id])

		expect(harness.statusOf(note.id)).toBe('queued')
		expect(board.get(note.id)).toBeNull()
	})

	it('gives an explain task no callback', async () => {
		const note = await noteRowFactory.transient({ db: harness.db }).create()
		const options: RunOptions[] = []

		harness.gemini.during = (received) => {
			options.push(received)
		}

		await harness.research([note.id])

		expect(harness.gemini.calls).toMatchObject([{ method: 'explain' }])
		expect(options.map(({ onProgress }) => onProgress)).toEqual([undefined])
	})

	it('ignores progress that arrives after the job timed out', async () => {
		const note = await ideaNote()
		const held = Promise.withResolvers<null>()

		harness.gemini.during = async ({ onProgress }) => {
			onProgress?.(searching)
			await held.promise
			onProgress?.(writing)
		}

		harness.queue([note.id])
		jest.advanceTimersByTime(0)
		await advanceBy(harness.runner, 16 * 60_000)

		// The abandoned handler was cleared when the job gave up on it.
		expect(board.get(note.id)).toBeNull()

		held.resolve(null)
		drainMicrotasks()
		expect(board.get(note.id)).toBeNull()
	})

	it('runs as before in a job without a board', async () => {
		await harness.runner.stop()
		harness = await startResearch()

		const note = await ideaNote()
		const options: RunOptions[] = []

		harness.gemini.during = (received) => {
			options.push(received)
		}

		await harness.research([note.id])

		expect(options.map(({ onProgress }) => onProgress)).toEqual([undefined])
		expect(harness.cardsOf(note.id)).toHaveLength(1)
	})
})
