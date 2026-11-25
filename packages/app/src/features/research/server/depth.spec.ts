// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { afterEach, beforeEach, describe, expect, it, jest, spyOn } from 'bun:test'
import { faker } from '@faker-js/faker'
import { sourceFactory } from '#tests/factories/cards'
import { categoryRowFactory } from '#tests/factories/categories'
import { noteRowFactory } from '#tests/factories/notes'
import { termRowFactory } from '#tests/factories/terms'
import { storeCard } from '#tests/setup/deeper'
import { jobRows } from '#tests/setup/jobs'
import { startResearch, type ResearchHarness } from '#tests/setup/research'

import { earlierCard } from '#/features/research/shared/formats'
import type { notes } from '#/server/db/schema/notes'
import { log } from '#/server/log'

const start = new Date('2026-11-20T10:00:00Z')

describe('deeper job', () => {
	let harness: ResearchHarness

	beforeEach(async () => {
		jest.useFakeTimers({ now: start })
		harness = await startResearch()
	})

	afterEach(async () => {
		await harness.runner.stop()
		jest.useRealTimers()
	})

	async function noteWithCard(overrides: Partial<typeof notes.$inferInsert> = {}) {
		return noteRowFactory.transient({ db: harness.db }).create({ status: 'read', ...overrides })
	}

	function depthsOf(noteId: number) {
		return harness.cardsOf(noteId).map(({ depth }) => depth)
	}

	describe('writing level 2', () => {
		let info: ReturnType<typeof spyOn<typeof log, 'info'>>

		beforeEach(() => {
			info = spyOn(log, 'info').mockImplementation(() => {
				// Keep the expected link counts out of the test log.
			})
		})

		afterEach(() => {
			info.mockRestore()
		})

		it('calls once with level 1 as the earlier card and saves a row of its own', async () => {
			const note = await noteWithCard()
			const first = await storeCard(harness.db, { noteId: note.id, depth: 1 })
			const [dead, open] = sourceFactory.buildList(2)
			harness.gemini.sources = [dead, open]
			harness.links.set(dead.url, { kind: 'dead', reason: 'HTTP 404' })

			await harness.deepen(note.id, 2)

			expect(harness.gemini.calls).toMatchObject([
				{
					method: 'explain',
					input: { depth: 2, output: { id: 'brief' }, previous: [earlierCard(first.card)] },
				},
			])
			const [{ input }] = harness.gemini.calls
			const sent = 'previous' in input ? input.previous : []

			expect(sent).toMatchObject([{ sources: first.card.sources }])
			expect(sent[0]).not.toHaveProperty('uncertain')
			expect(harness.cardsOf(note.id)).toMatchObject([
				{ id: first.row.id, depth: 1, body: first.row.body },
				{ depth: 2, format: 'brief', isDraft: false, sources: [open], isUncertain: false },
			])
			expect(info).toHaveBeenCalledWith('Checked card links', {
				noteId: note.id,
				depth: 2,
				kept: 1,
				dropped: 1,
			})
			expect(jobRows(harness.db)).toMatchObject([{ kind: 'deeper', status: 'done' }])
			expect(harness.learn).not.toHaveBeenCalled()
		})

		it('writes in the format of level 1 after the note moved to a category of another format', async () => {
			const category = await categoryRowFactory.transient({ db: harness.db }).create({
				format: 'technology',
			})

			const note = await noteWithCard({ categoryId: category.id })
			await storeCard(harness.db, { noteId: note.id, depth: 1, format: 'brief' })

			await harness.deepen(note.id, 2)

			expect(harness.gemini.calls).toMatchObject([
				{ input: { output: { id: 'brief' }, category: { name: category.name } } },
			])
			expect(harness.cardsOf(note.id)).toMatchObject([{ depth: 1 }, { depth: 2, format: 'brief' }])
		})

		it('writes level 2 under a draft level 1', async () => {
			const note = await noteWithCard()
			await storeCard(harness.db, { noteId: note.id, depth: 1, isDraft: true })

			await harness.deepen(note.id, 2)

			expect(harness.cardsOf(note.id)).toMatchObject([
				{ depth: 1, isDraft: true },
				{ depth: 2, isDraft: false },
			])
		})

		it('writes a report through the research task', async () => {
			const note = await noteWithCard()
			await storeCard(harness.db, { noteId: note.id, depth: 1, format: 'report' })

			await harness.deepen(note.id, 2)

			expect(harness.gemini.calls).toMatchObject([
				{ method: 'research', tier: 'deep', input: { output: { id: 'report' } } },
			])
			expect(harness.cardsOf(note.id)).toMatchObject([{ depth: 1 }, { depth: 2, format: 'report' }])
		})
	})

	it('gives level 3 both earlier cards in depth order', async () => {
		const note = await noteWithCard()
		const second = await storeCard(harness.db, { noteId: note.id, depth: 2 })
		const first = await storeCard(harness.db, { noteId: note.id, depth: 1 })

		await harness.deepen(note.id, 3)

		expect(harness.gemini.calls).toMatchObject([
			{ input: { depth: 3, previous: [earlierCard(first.card), earlierCard(second.card)] } },
		])
		expect(depthsOf(note.id)).toEqual([2, 1, 3])
	})

	describe('the note status', () => {
		it('turns a read note ready, because the new level is unread', async () => {
			const note = await noteWithCard({ status: 'read' })
			await storeCard(harness.db, { noteId: note.id, depth: 1 })

			await harness.deepen(note.id, 2)

			expect(harness.statusOf(note.id)).toBe('ready')
		})

		it('leaves a ready note ready', async () => {
			const note = await noteWithCard({ status: 'ready' })
			await storeCard(harness.db, { noteId: note.id, depth: 1 })

			await harness.deepen(note.id, 2)

			expect(harness.statusOf(note.id)).toBe('ready')
			expect(depthsOf(note.id)).toEqual([1, 2])
		})
	})

	describe('when there is nothing to write', () => {
		afterEach(() => {
			expect(harness.gemini.calls).toEqual([])
			expect(jobRows(harness.db)).toMatchObject([{ status: 'done', attempts: 1 }])
		})

		it('skips a deleted note', async () => {
			const note = await noteWithCard({ deletedAt: faker.date.past() })
			await storeCard(harness.db, { noteId: note.id, depth: 1 })

			await harness.deepen(note.id, 2)

			expect(depthsOf(note.id)).toEqual([1])
		})

		it('skips an archived note and keeps it archived', async () => {
			const note = await noteWithCard({ status: 'archived' })
			await storeCard(harness.db, { noteId: note.id, depth: 1 })

			await harness.deepen(note.id, 2)

			expect(depthsOf(note.id)).toEqual([1])
			expect(harness.statusOf(note.id)).toBe('archived')
		})

		it('skips a note without a first card', async () => {
			const note = await noteWithCard({ status: 'new' })

			await harness.deepen(note.id, 2)

			expect(depthsOf(note.id)).toEqual([])
			expect(harness.statusOf(note.id)).toBe('new')
		})

		it('skips level 3 when level 2 is missing', async () => {
			const note = await noteWithCard()
			await storeCard(harness.db, { noteId: note.id, depth: 1 })

			await harness.deepen(note.id, 3)

			expect(depthsOf(note.id)).toEqual([1])
		})

		it('skips a level that is already finished', async () => {
			const note = await noteWithCard()
			await storeCard(harness.db, { noteId: note.id, depth: 1 })
			await storeCard(harness.db, { noteId: note.id, depth: 2 })

			await harness.deepen(note.id, 2)

			expect(depthsOf(note.id)).toEqual([1, 2])
			expect(harness.statusOf(note.id)).toBe('read')
		})
	})

	describe('a private note', () => {
		it('sends its term alone and no earlier card', async () => {
			const term = await termRowFactory.transient({ db: harness.db }).create()

			const note = await noteWithCard({
				termId: term.id,
				text: faker.lorem.sentence(),
				url: faker.internet.url(),
				isPrivate: true,
			})

			const first = await storeCard(harness.db, { noteId: note.id, depth: 1 })

			await harness.deepen(note.id, 2)

			const [call] = harness.gemini.calls
			const received = JSON.stringify(call.input)

			expect(call.input).toMatchObject({
				note: { term: term.term, text: null, context: null, url: null, isPrivate: true },
				depth: 2,
				previous: [],
			})
			expect(
				[note.text, note.context, note.url, JSON.stringify(first.card.sources)].filter((value) =>
					received.includes(`${value}`),
				),
			).toEqual([])
			expect(depthsOf(note.id)).toEqual([1, 2])
		})

		it('makes no call without a term and keeps its status', async () => {
			const info = spyOn(log, 'info').mockImplementation(() => {
				// Keep the expected skip out of the test log.
			})

			const note = await noteWithCard({ isPrivate: true })
			await storeCard(harness.db, { noteId: note.id, depth: 1 })

			await harness.deepen(note.id, 2)

			expect(harness.gemini.calls).toEqual([])
			expect(depthsOf(note.id)).toEqual([1])
			expect(harness.statusOf(note.id)).toBe('read')
			expect(info).toHaveBeenCalledWith(expect.stringContaining('private note without a term'), {
				noteId: note.id,
				depth: 2,
			})
			info.mockRestore()
		})
	})
})
