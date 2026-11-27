// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { beforeEach, describe, expect, it } from 'bun:test'
import { faker } from '@faker-js/faker'
import { categoryRowFactory } from '#tests/factories/categories'
import { explanationRowFactory } from '#tests/factories/explanations'
import { noteRowFactory } from '#tests/factories/notes'
import { createTestDb, type TestDb } from '#tests/setup/db'
import { sql } from 'drizzle-orm'
import * as v from 'valibot'

import { baseNotesQuerySchema } from '../schemas'
import {
	basePreviewSize,
	listKept,
	readBase,
	selectKept,
	selectKeptCount,
	selectKeptCounts,
} from './base'

const capturedAt = new Date('2026-11-20T08:00:00Z')

function minutesAfter(minutes: number) {
	return new Date(capturedAt.getTime() + minutes * 60_000)
}

describe('Base', () => {
	let db: TestDb

	beforeEach(async () => {
		;({ db } = await createTestDb())
	})

	/** A note kept `minute` minutes after the capture time. */
	async function keptAt(minute: number, fields: Parameters<typeof noteRowFactory.build>[0] = {}) {
		return noteRowFactory.transient({ db }).create({ keptAt: minutesAfter(minute), ...fields })
	}

	function page(params: Record<string, string>) {
		return listKept(db, v.parse(baseNotesQuerySchema, params))
	}

	function plan(query: { getSQL: () => ReturnType<typeof sql> }) {
		return db
			.all<{ detail: string }>(sql`EXPLAIN QUERY PLAN ${query.getSQL()}`)
			.map(({ detail }) => detail)
			.join('\n')
	}

	describe('readBase', () => {
		it('groups the kept notes in the owner’s category order, the uncategorized ones last', async () => {
			const categories = categoryRowFactory.transient({ db })
			const second = await categories.create({ position: 20 })
			const first = await categories.create({ position: 10 })
			const unused = await categories.create({ position: 5 })
			await keptAt(0)
			await keptAt(1, { categoryId: second.id })
			await keptAt(2, { categoryId: first.id })
			// Neither kept nor live, so the category has nothing in Base.
			await noteRowFactory.transient({ db }).create({ categoryId: unused.id })
			await keptAt(3, { categoryId: unused.id, deletedAt: capturedAt })

			const groups = readBase(db).groups.map(({ categoryId, count }) => ({ categoryId, count }))

			expect(groups).toEqual([
				{ categoryId: first.id, count: 1 },
				{ categoryId: second.id, count: 1 },
				{ categoryId: null, count: 1 },
			])
		})

		it('previews the most recently kept notes of a group while counting all of them', async () => {
			const category = await categoryRowFactory.transient({ db }).create()

			const notes = await Promise.all(
				[0, 1, 2, 3, 4].map(async (minute) => keptAt(minute, { categoryId: category.id })),
			)

			await keptAt(5)

			const newest = notes
				.toReversed()
				.slice(0, basePreviewSize)
				.map(({ id }) => id)

			const overview = readBase(db)

			expect({
				total: overview.total,
				group: { ...overview.groups[0], notes: overview.groups[0]?.notes.map(({ id }) => id) },
			}).toEqual({ total: 6, group: { categoryId: category.id, count: 5, notes: newest } })
		})

		it('orders by the kept time, not the capture time', async () => {
			const keptLater = await keptAt(5, { createdAt: capturedAt })
			const keptEarlier = await keptAt(1, { createdAt: minutesAfter(10) })

			expect(readBase(db).groups[0]?.notes.map(({ id }) => id)).toEqual([
				keptLater.id,
				keptEarlier.id,
			])
		})

		it('answers an empty overview when nothing is kept', async () => {
			await noteRowFactory.transient({ db }).create()

			expect(readBase(db)).toEqual({ total: 0, groups: [] })
		})

		it('lists a private note with its lock and its card’s sense', async () => {
			const privateNote = await keptAt(0, { isPrivate: true })
			const sense = faker.lorem.words(3)
			await explanationRowFactory
				.transient({ db })
				.create({ noteId: privateNote.id, body: { sense } })

			expect(readBase(db).groups[0]?.notes[0]).toMatchObject({
				id: privateNote.id,
				private: true,
				sense,
				snippet: null,
			})
		})
	})

	describe('a group’s page', () => {
		it('pages notes kept at the same time by id, without repeats or skips', async () => {
			const category = await categoryRowFactory.transient({ db }).create()

			const same = await noteRowFactory
				.transient({ db })
				.createList(5, { categoryId: category.id, keptAt: capturedAt })

			const newer = await keptAt(1, { categoryId: category.id })
			const pages: { ids: number[]; total: number | null }[] = []
			let cursor: string | undefined

			do {
				const params = { categoryId: String(category.id), limit: '2' }
				const found = page(cursor === undefined ? params : { ...params, cursor })

				pages.push({ ids: found.notes.map(({ id }) => id), total: found.total })
				cursor = found.nextCursor ?? undefined
				// A cursor that never ran out would loop forever; three pages hold every note.
			} while (cursor !== undefined && pages.length < 4)

			const ids = [newer.id, ...same.map(({ id }) => id).toReversed()]

			expect(pages).toEqual([
				{ ids: ids.slice(0, 2), total: 6 },
				{ ids: ids.slice(2, 4), total: 6 },
				{ ids: ids.slice(4), total: 6 },
			])
		})

		it('reads the uncategorized notes with categoryId none', async () => {
			const category = await categoryRowFactory.transient({ db }).create()
			const loose = await keptAt(0)
			await keptAt(1, { categoryId: category.id })

			expect(page({ categoryId: 'none' })).toMatchObject({
				notes: [{ id: loose.id, categoryId: null }],
				nextCursor: null,
				total: 1,
			})
		})

		it('leaves out the notes that are not kept or are deleted', async () => {
			const category = await categoryRowFactory.transient({ db }).create()
			const kept = await keptAt(0, { categoryId: category.id })
			await noteRowFactory.transient({ db }).create({ categoryId: category.id })
			await keptAt(1, { categoryId: category.id, deletedAt: capturedAt })

			expect(page({ categoryId: String(category.id) })).toMatchObject({
				notes: [{ id: kept.id }],
				total: 1,
			})
		})
	})

	describe('a search', () => {
		it('finds the words in the text, the context and the card, only in kept notes', async () => {
			const inText = await keptAt(0, { text: 'Etcd', context: null })
			const inContext = await keptAt(1, { text: 'Raft', context: 'seen in the etcd docs' })
			const inCard = await keptAt(2, { text: 'Paxos', context: null })
			await explanationRowFactory
				.transient({ db })
				.create({ noteId: inCard.id, body: { sense: 'like etcd', summary: 'consensus' } })
			await noteRowFactory.transient({ db }).create({ text: 'etcd' })
			await keptAt(3, { text: 'etcd', deletedAt: capturedAt })

			expect(page({ q: 'etcd' })).toMatchObject({
				notes: [{ id: inCard.id }, { id: inContext.id }, { id: inText.id }],
				nextCursor: null,
				total: 3,
			})
		})

		it('lists the matches most recently kept first, across categories, and pages them', async () => {
			const category = await categoryRowFactory.transient({ db }).create()
			const keptFirst = await keptAt(0, { text: 'Kafka', createdAt: minutesAfter(30) })
			const keptLast = await keptAt(2, { text: 'Kafka', categoryId: category.id })
			const keptBetween = await keptAt(1, { text: 'Kafka Streams', createdAt: minutesAfter(20) })

			const first = page({ q: 'kaf', limit: '2' })
			const second = page({ q: 'kaf', limit: '2', cursor: first.nextCursor ?? '' })

			expect([
				{ ids: first.notes.map(({ id }) => id), total: first.total },
				{ ids: second.notes.map(({ id }) => id), total: second.total, next: second.nextCursor },
			]).toEqual([
				{ ids: [keptLast.id, keptBetween.id], total: 3 },
				{ ids: [keptFirst.id], total: 3, next: null },
			])
		})

		it('marks the matched words in the snippet', async () => {
			await keptAt(0, { text: 'Raft', context: 'seen in the etcd docs' })

			expect(page({ q: 'etc' }).notes[0]?.snippet).toEqual([
				{ text: 'seen in the ', match: false },
				{ text: 'etcd', match: true },
				{ text: ' docs', match: false },
			])
		})

		it('answers an empty page for a search without words', async () => {
			await keptAt(0)

			expect(page({ q: '?!.,' })).toEqual({ notes: [], nextCursor: null, total: 0 })
		})
	})

	describe('the queries', () => {
		it.each([
			['every kept note', () => selectKept(db, { limit: basePreviewSize })],
			[
				'a category after a cursor',
				() => selectKept(db, { categoryId: 1, cursor: { createdAt: 1, id: 7 }, limit: 50 }),
			],
			['the uncategorized notes', () => selectKept(db, { categoryId: null, limit: 50 })],
			['the counts by category', () => selectKeptCounts(db)],
			['the count of a category', () => selectKeptCount(db, 1)],
			['the count of the uncategorized notes', () => selectKeptCount(db, null)],
		])('reads only the kept index for %s', (_case, query) => {
			const detail = plan(query())

			expect({
				kept: detail.includes('notes_kept_at_idx'),
				category: detail.includes('notes_category_id_created_at_idx'),
				sorted: detail.includes('TEMP B-TREE FOR ORDER BY'),
			}).toEqual({ kept: true, category: false, sorted: false })
		})
	})
})
