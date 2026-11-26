// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test'
import { categoryRowFactory } from '#tests/factories/categories'
import { noteRowFactory } from '#tests/factories/notes'
import { createTestDb, type TestDb } from '#tests/setup/db'
import { inArray } from 'drizzle-orm'

import { notes, type NoteStatus } from '#/server/db/schema/notes'
import { HttpError } from '#/server/http'

import { changeNotes } from './bulk'
import * as publicNote from './public-note'

const deletedAt = new Date('2026-11-20T08:00:00Z')

function outcomes(results: ReturnType<typeof changeNotes>) {
	return results.map(({ id, outcome }) => [id, outcome])
}

/** The status and issues of the HTTP error an action throws, or null when it throws none. */
function httpErrorOf(action: () => void) {
	try {
		action()
	} catch (error) {
		if (error instanceof HttpError) {
			return { status: error.status, issues: error.details.issues }
		}

		throw error
	}

	return null
}

describe('changeNotes', () => {
	let db: TestDb

	beforeEach(async () => {
		;({ db } = await createTestDb())
	})

	function stored(ids: number[]) {
		return db
			.select({ id: notes.id, status: notes.status, categoryId: notes.categoryId })
			.from(notes)
			.where(inArray(notes.id, ids))
			.orderBy(notes.id)
			.all()
	}

	describe('archive', () => {
		it.each<[NoteStatus, string]>([
			['new', 'changed'],
			['ready', 'changed'],
			['read', 'changed'],
			['failed', 'changed'],
			['archived', 'unchanged'],
			['queued', 'conflict'],
			['researching', 'conflict'],
		])('answers a note with status %s as %s', async (status, outcome) => {
			const { id } = await noteRowFactory.transient({ db }).create({ status })
			const expected = outcome === 'conflict' ? status : 'archived'

			const [result] = changeNotes(db, [id], { status: 'archived' })

			expect([result, stored([id])[0]?.status]).toMatchObject([
				{ id, outcome, note: { id, status: expected } },
				expected,
			])
		})

		it('answers each note in request order, once per id', async () => {
			const [first, second] = await noteRowFactory.transient({ db }).createList(2)
			const missing = second.id + 100

			const results = changeNotes(db, [second.id, missing, first.id, second.id], {
				status: 'archived',
			})

			expect(outcomes(results)).toEqual([
				[second.id, 'changed'],
				[missing, 'not_found'],
				[first.id, 'changed'],
			])
		})

		it('answers unchanged to a repeat', async () => {
			const created = await noteRowFactory.transient({ db }).createList(2)
			const ids = created.map(({ id }) => id)

			changeNotes(db, ids, { status: 'archived' })

			expect(outcomes(changeNotes(db, ids, { status: 'archived' }))).toEqual(
				ids.map((id) => [id, 'unchanged']),
			)
		})
	})

	describe('category', () => {
		it('moves notes, leaving the ones already there unchanged and the status as it was', async () => {
			const category = await categoryRowFactory.transient({ db }).create()

			const filed = await noteRowFactory
				.transient({ db })
				.create({ categoryId: category.id, status: 'queued' })

			const loose = await noteRowFactory.transient({ db }).create({ status: 'researching' })

			const results = changeNotes(db, [filed.id, loose.id], { categoryId: category.id })

			expect([outcomes(results), stored([filed.id, loose.id])]).toEqual([
				[
					[filed.id, 'unchanged'],
					[loose.id, 'changed'],
				],
				[
					{ id: filed.id, status: 'queued', categoryId: category.id },
					{ id: loose.id, status: 'researching', categoryId: category.id },
				],
			])
		})

		it('answers 400 for a category that does not exist and changes nothing', async () => {
			const { id } = await noteRowFactory.transient({ db }).create()

			const error = httpErrorOf(() => {
				changeNotes(db, [id], { categoryId: 404 })
			})

			expect([error, stored([id])]).toEqual([
				{ status: 400, issues: ['categoryId: There is no such category.'] },
				[{ id, status: 'new', categoryId: null }],
			])
		})
	})

	describe('a deleted note', () => {
		it('answers not_found and stays deleted and as it was', async () => {
			const category = await categoryRowFactory.transient({ db }).create()
			const deleted = await noteRowFactory.transient({ db }).create({ deletedAt })

			const results = [
				...changeNotes(db, [deleted.id], { status: 'archived' }),
				...changeNotes(db, [deleted.id], { categoryId: category.id }),
			]

			const row = db
				.select()
				.from(notes)
				.where(inArray(notes.id, [deleted.id]))
				.get()

			expect([results, row]).toMatchObject([
				[
					{ id: deleted.id, outcome: 'not_found', note: null },
					{ id: deleted.id, outcome: 'not_found', note: null },
				],
				{ status: 'new', categoryId: null, deletedAt },
			])
		})
	})

	describe('when a step throws part-way', () => {
		beforeEach(() => {
			spyOn(publicNote, 'toPublicNote').mockImplementation(() => {
				throw new Error('The answer could not be built.')
			})
		})

		afterEach(() => {
			mock.restore()
		})

		it.each(['category', 'archive'])('leaves every note as it was on a %s change', async (kind) => {
			const category = await categoryRowFactory.transient({ db }).create()
			const created = await noteRowFactory.transient({ db }).createList(3)
			const ids = created.map(({ id }) => id)

			const change =
				kind === 'category' ? { categoryId: category.id } : { status: 'archived' as const }

			expect(() => changeNotes(db, ids, change)).toThrow('The answer could not be built.')
			expect(stored(ids)).toEqual(ids.map((id) => ({ id, status: 'new', categoryId: null })))
		})
	})
})
