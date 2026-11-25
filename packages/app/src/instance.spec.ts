// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { drainMicrotasks } from 'bun:jsc'
import { afterEach, beforeEach, describe, expect, it, jest, mock, spyOn } from 'bun:test'
import { briefCardFactory } from '#tests/factories/cards'
import { categoryRowFactory } from '#tests/factories/categories'
import { noteRowFactory } from '#tests/factories/notes'
import { configuredSettingsFactory } from '#tests/factories/settings'
import { termRowFactory } from '#tests/factories/terms'
import { createTestDb } from '#tests/setup/db'
import { advanceTo, jobRows } from '#tests/setup/jobs'

import * as instance from '#/server/db/instance'
import { explanations } from '#/server/db/schema/explanations'
import { jobs } from '#/server/db/schema/jobs'
import { notes } from '#/server/db/schema/notes'
import { parseOutput } from '#/server/engines/contract'
import * as engines from '#/server/engines/router'
import { startRunner, stopRunner } from '#/server/jobs/runner'
import type { Runner } from '#/server/jobs/types'
import { log } from '#/server/log'

import {
	instanceBatchJob,
	instanceResearchJob,
	instanceResearchNow,
	instanceSuggester,
} from './instance'

const { db } = await createTestDb()

const start = new Date('2026-11-21T06:00:00Z')

const batchTime = '2026-11-21T06:30:00Z'

const readyMessage = 'A research-now card is ready'

const reset = new Date('2026-11-21T07:30:00Z')

async function unexpectedCall(): Promise<never> {
	throw new Error('The batch explains brief cards')
}

function cards() {
	return db
		.select({
			noteId: explanations.noteId,
			depth: explanations.depth,
			isDraft: explanations.isDraft,
		})
		.from(explanations)
		.orderBy(explanations.noteId)
		.all()
}

describe('instance', () => {
	describe('instanceSuggester', () => {
		beforeEach(() => {
			spyOn(instance, 'instanceDb').mockResolvedValue(db)
			spyOn(engines, 'createRouter').mockImplementation(() => {
				throw new Error('Invalid command')
			})
		})

		afterEach(() => {
			mock.restore()
		})

		it('answers history when the router cannot be built', async () => {
			const { id } = await categoryRowFactory.transient({ db }).create()
			const { term } = termRowFactory.build()
			const service = await instanceSuggester()

			const answer = await service.suggest(db, {
				note: { text: term, context: null, url: null, isPrivate: false },
				history: [{ categoryId: id, meaning: '' }],
				language: configuredSettingsFactory.build().cardLanguage,
			})

			expect(answer).toEqual({
				categories: [id],
				senses: [],
				language: null,
				source: 'history',
				pending: false,
			})
			expect(engines.createRouter).not.toHaveBeenCalled()
		})
	})

	describe('nightly batch', () => {
		let runner: Runner
		let info: ReturnType<typeof spyOn<typeof log, 'info'>>
		let categoryId: number
		let calls: string[]
		let inFlight: number
		let peakInFlight: number
		let waitForAnswer: Promise<null> | undefined
		let draftRedoAt: Date | undefined

		beforeEach(async () => {
			jest.useFakeTimers({ now: start })
			// The services keep their database and router across runner restarts.
			db.delete(jobs).run()
			db.delete(notes).run()
			calls = []
			inFlight = 0
			peakInFlight = 0
			waitForAnswer = undefined
			draftRedoAt = undefined

			const card = briefCardFactory.build({ sources: [] })

			info = spyOn(log, 'info').mockImplementation(() => {
				// Keep the expected messages out of the test log.
			})
			spyOn(instance, 'instanceDb').mockResolvedValue(db)
			spyOn(engines, 'createRouter').mockReturnValue({
				suggest: unexpectedCall,
				research: unexpectedCall,
				async explain(input) {
					calls.push(input.note.term)
					inFlight += 1
					peakInFlight = Math.max(peakInFlight, inFlight)

					try {
						await waitForAnswer

						const result = {
							output: parseOutput(input.output, card),
							engine: 'gemini',
							model: null,
							searchSuggestions: null,
							elapsedMs: 0,
						}

						const redoAt = draftRedoAt

						draftRedoAt = undefined

						return redoAt === undefined
							? { ...result, draft: false }
							: { ...result, draft: true, redoAt }
					} finally {
						inFlight -= 1
					}
				},
			})

			const category = await categoryRowFactory.transient({ db }).create({ format: 'brief' })

			categoryId = category.id
			runner = await startRunner({
				db,
				jobs: [await instanceResearchJob()],
				schedules: [{ job: await instanceBatchJob(), at: '06:30' }],
				timeZone: () => 'UTC',
			})
		})

		afterEach(async () => {
			await stopRunner()
			jest.useRealTimers()
			mock.restore()
		})

		async function saveNote(createdAt = new Date()) {
			return noteRowFactory.transient({ db }).create({ categoryId, createdAt })
		}

		it('writes cards for ten notes in creation order, one at a time', async () => {
			const saved = await Promise.all(
				Array.from({ length: 10 }, async (_, index) =>
					saveNote(new Date(start.getTime() - index * 60_000)),
				),
			)

			await advanceTo(runner, '2026-11-21T06:29:59Z')
			expect(calls).toEqual([])

			await advanceTo(runner, batchTime)

			expect(calls).toEqual(saved.toReversed().map(({ text }) => text))
			expect(peakInFlight).toBe(1)
			expect(cards()).toEqual(saved.map(({ id }) => ({ noteId: id, depth: 1, isDraft: false })))
		})

		it('requeues a draft at the reset and replaces it with a finished card', async () => {
			const note = await saveNote()

			draftRedoAt = reset
			await advanceTo(runner, batchTime)

			expect(cards()).toEqual([{ noteId: note.id, depth: 1, isDraft: true }])
			expect(
				jobRows(db).filter(({ kind, status }) => kind === 'research' && status === 'queued'),
			).toMatchObject([{ payload: { noteId: note.id }, runAt: reset }])

			await advanceTo(runner, reset.toISOString())

			expect(cards()).toEqual([{ noteId: note.id, depth: 1, isDraft: false }])
			expect(calls).toEqual([note.text, note.text])
		})

		it('runs a research-now job ahead of the remaining batch jobs', async () => {
			const first = await saveNote()
			const second = await saveNote()
			const third = await saveNote()
			const urgent = noteRowFactory.build({ categoryId })
			let urgentId = 0
			const { promise, resolve } = Promise.withResolvers<null>()

			waitForAnswer = promise

			try {
				jest.advanceTimersByTime(new Date(batchTime).getTime() - Date.now())
				drainMicrotasks()
				expect(calls).toEqual([first.text])

				// Saved after the batch ran, so only the request queues it.
				urgentId = db.insert(notes).values(urgent).returning({ id: notes.id }).get().id

				await instanceResearchNow([urgentId])
			} finally {
				resolve(null)
			}

			await runner.idle()

			expect(calls).toEqual([first.text, urgent.text, second.text, third.text])
			expect(info.mock.calls.filter(([message]) => message === readyMessage)).toEqual([
				[readyMessage, { noteId: urgentId }],
			])
		})
	})
})
