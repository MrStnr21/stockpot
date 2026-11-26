// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { beforeEach, describe, expect, it } from 'bun:test'
import { categoryRowFactory } from '#tests/factories/categories'
import { noteRowFactory } from '#tests/factories/notes'
import { createTestDb, type TestDb } from '#tests/setup/db'

import { countNotes } from './counts'

describe('countNotes', () => {
	let db: TestDb

	beforeEach(async () => {
		;({ db } = await createTestDb())
	})

	it('counts live notes by category and status, without a category too', async () => {
		const category = await categoryRowFactory.transient({ db }).create()
		const notes = noteRowFactory.transient({ db })

		await notes.createList(2, { categoryId: category.id, status: 'ready' })
		await notes.create({ categoryId: category.id, status: 'archived' })
		await notes.create({ status: 'failed' })
		await notes.create({ categoryId: category.id, status: 'ready', deletedAt: new Date() })

		expect(countNotes(db).toSorted((a, b) => a.status.localeCompare(b.status))).toEqual([
			{ categoryId: category.id, status: 'archived', count: 1 },
			{ categoryId: null, status: 'failed', count: 1 },
			{ categoryId: category.id, status: 'ready', count: 2 },
		])
	})

	it('answers no rows without notes', () => {
		expect(countNotes(db)).toEqual([])
	})
})
