// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { beforeEach, describe, expect, it } from 'bun:test'
import { noteRowFactory } from '#tests/factories/notes'
import { createTestDb, type TestDb } from '#tests/setup/db'

import { noFilters } from '../shared/filters'
import { firstPage } from './first-page'

describe('the first page for the island', () => {
	let db: TestDb

	beforeEach(async () => {
		;({ db } = await createTestDb())
	})

	it('carries the dates as ISO strings and no search total without a search', async () => {
		const createdAt = new Date('2026-11-20T08:00:00Z')

		const { id } = await noteRowFactory
			.transient({ db })
			.create({ createdAt, updatedAt: createdAt })

		const page = firstPage(db, noFilters)

		expect(page).toMatchObject({
			notes: [{ id, createdAt: '2026-11-20T08:00:00.000Z', updatedAt: '2026-11-20T08:00:00.000Z' }],
			nextCursor: null,
			total: null,
		})
	})

	it('applies the status and the search', async () => {
		const notes = noteRowFactory.transient({ db })
		const { id } = await notes.create({ text: 'kafka streams', status: 'ready' })

		await notes.create({ text: 'kafka topics', status: 'new' })
		await notes.create({ text: 'serendipity', status: 'ready' })

		const page = firstPage(db, { ...noFilters, status: 'ready', q: 'kaf' })

		expect(page.total).toBe(1)
		expect(page.notes.map((note) => note.id)).toEqual([id])
		expect(page.notes[0]?.snippet?.some(({ match }) => match)).toBe(true)
	})
})
