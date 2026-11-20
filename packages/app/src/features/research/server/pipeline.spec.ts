// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { afterEach, beforeEach, describe, expect, it, jest, spyOn } from 'bun:test'
import { faker } from '@faker-js/faker'
import { sourceFactory } from '#tests/factories/cards'
import { categoryRowFactory } from '#tests/factories/categories'
import { noteRowFactory } from '#tests/factories/notes'
import { termRowFactory } from '#tests/factories/terms'
import { advanceBy, advanceTo, jobRows } from '#tests/setup/jobs'
import { limitedUntil, startResearch, type ResearchHarness } from '#tests/setup/research'
import { eq } from 'drizzle-orm'

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

	it('takes a queued note through researching to ready with one card and one call', async () => {
		const note = await noteRowFactory.transient({ db: harness.db }).create()
		const seen: unknown[] = []

		harness.gemini.during = () => {
			seen.push(harness.statusOf(note.id))
		}

		harness.queue([note.id])
		seen.unshift(harness.statusOf(note.id))
		await advanceBy(harness.runner, 0)

		expect([...seen, harness.statusOf(note.id)]).toEqual(['queued', 'researching', 'ready'])
		expect(harness.gemini.calls).toMatchObject([{ method: 'explain' }])
		expect(harness.cardsOf(note.id)).toMatchObject([{ engine: 'gemini', depth: 1, isDraft: false }])
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
		expect(harness.statusOf(note.id)).toBe('ready')
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
		expect(harness.cardsOf(note.id)).toMatchObject([{ format: 'report', isDraft: false }])
	})

	describe('source checks', () => {
		let info: ReturnType<typeof spyOn<typeof log, 'info'>>

		beforeEach(() => {
			info = spyOn(log, 'info').mockImplementation(() => {
				// Keep the expected link counts out of the test log.
			})
		})

		afterEach(() => {
			info.mockRestore()
		})

		it('saves the open source and leaves the card certain when another source is dead', async () => {
			const term = await termRowFactory.transient({ db: harness.db }).create()

			const note = await noteRowFactory.transient({ db: harness.db }).create({
				termId: term.id,
				isPrivate: true,
			})

			const [deadSource, openSource] = sourceFactory.buildList(2)
			harness.gemini.sources = [deadSource, openSource]
			harness.links.set(deadSource.url, { kind: 'dead', reason: 'HTTP 404' })

			await harness.research([note.id])

			expect(harness.cardsOf(note.id)).toMatchObject([
				{ sources: [openSource], isUncertain: false },
			])
			expect(info).toHaveBeenCalledWith('Checked card links', {
				noteId: note.id,
				kept: 1,
				dropped: 1,
			})
		})

		it('saves an uncertain card without sources when every source is dead', async () => {
			const note = await noteRowFactory.transient({ db: harness.db }).create()
			const sources = sourceFactory.buildList(2)
			harness.gemini.sources = sources

			for (const { url } of sources) {
				harness.links.set(url, { kind: 'dead', reason: 'HTTP 404' })
			}

			await harness.research([note.id])

			expect(harness.cardsOf(note.id)).toMatchObject([{ sources: [], isUncertain: true }])
		})
	})

	it('stores a draft while the primary engine is limited and replaces it at the reset', async () => {
		const note = await noteRowFactory.transient({ db: harness.db }).create()

		harness.gemini.failure = limitedUntil(inAnHour)
		await harness.research([note.id])

		expect(harness.cardsOf(note.id)).toMatchObject([{ engine: 'openai-compatible', isDraft: true }])
		expect(harness.statusOf(note.id)).toBe('ready')
		expect(harness.later).toHaveBeenCalledWith({ noteId: note.id }, inAnHour)

		harness.gemini.failure = null
		await advanceTo(harness.runner, inAnHour.toISOString())

		expect(harness.cardsOf(note.id)).toMatchObject([{ engine: 'gemini', isDraft: false }])
		expect(harness.statusOf(note.id)).toBe('ready')
		expect(harness.openAi.calls).toHaveLength(1)
	})

	it('requeues a draft one minute from now when the primary reset has passed', async () => {
		const note = await noteRowFactory.transient({ db: harness.db }).create()
		harness.gemini.failure = limitedUntil(new Date(start.getTime() - 1000))
		harness.openAi.during = () => {
			harness.gemini.failure = null
		}

		await harness.research([note.id])

		expect(jobRows(harness.db)).toMatchObject([
			{ status: 'done' },
			{ status: 'queued', runAt: new Date(Date.now() + 60_000) },
		])
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

			expect(harness.statusOf(note.id)).toBe('failed')
			expect(jobRows(harness.db)).toMatchObject([{ status: 'done', attempts: 1 }])
			expect(warn).toHaveBeenCalledWith(expect.any(String), { noteId: note.id, kind: 'auth' })
		})
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
			expect(harness.statusOf(note.id)).toBe('ready')
		})

		it('logs a failed learning step and keeps the card', async () => {
			const term = await termRowFactory.transient({ db: harness.db }).create()
			const note = await noteRowFactory.transient({ db: harness.db }).create({ termId: term.id })

			harness.learn.mockImplementation(() => {
				throw new Error('The database is locked')
			})
			await harness.research([note.id])

			expect(harness.statusOf(note.id)).toBe('ready')
			expect(harness.cardsOf(note.id)).toHaveLength(1)
			expect(jobRows(harness.db)).toMatchObject([{ status: 'done' }])
			expect(warn).toHaveBeenCalledWith(expect.any(String), {
				noteId: note.id,
				termId: term.id,
				name: 'Error',
			})
		})
	})

	it('makes no call for a queued note deleted before the run', async () => {
		const note = await noteRowFactory.transient({ db: harness.db }).create({
			status: 'queued',
			deletedAt: faker.date.past(),
		})

		await harness.research([note.id])

		expect(harness.gemini.calls).toEqual([])
		expect(harness.statusOf(note.id)).toBe('new')
		expect(harness.cardsOf(note.id)).toEqual([])
		expect(jobRows(harness.db)).toMatchObject([{ status: 'done' }])
	})

	it('discards the answer and releases a note deleted during the router call', async () => {
		const note = await noteRowFactory.transient({ db: harness.db }).create()
		harness.gemini.during = () => {
			harness.db.update(notes).set({ deletedAt: new Date() }).where(eq(notes.id, note.id)).run()
		}

		await harness.research([note.id])

		expect(harness.statusOf(note.id)).toBe('new')
		expect(harness.cardsOf(note.id)).toEqual([])
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

		expect(ids.map((id) => harness.statusOf(id))).toEqual(['queued', 'queued', 'read', 'new'])
		expect(jobRows(harness.db)).toMatchObject(
			ids.map((noteId) => ({ kind: 'research', status: 'queued', payload: { noteId } })),
		)
	})
})
