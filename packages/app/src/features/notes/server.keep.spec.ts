// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { afterEach, beforeEach, describe, expect, it, jest } from 'bun:test'
import { noteRowFactory } from '#tests/factories/notes'
import { createTestDb, type TestDb } from '#tests/setup/db'
import { eq } from 'drizzle-orm'

import { notes } from '#/server/db/schema/notes'
import { HttpError } from '#/server/http'

import { changeNote, deleteNote } from './server'

/** The status of the HTTP error a change throws, or `null` when it throws none. */
function statusThrownBy(action: () => void) {
	try {
		action()
	} catch (error) {
		if (error instanceof HttpError) {
			return error.status
		}

		throw error
	}

	return null
}

const keptAt = new Date('2026-11-20T08:00:00Z')

const later = new Date('2026-11-21T09:30:00Z')

describe('changeNote kept', () => {
	let db: TestDb
	let id: number

	beforeEach(async () => {
		jest.useFakeTimers({ now: keptAt })
		;({ db } = await createTestDb())
		;({ id } = await noteRowFactory.transient({ db }).create({ status: 'ready' }))
	})

	afterEach(() => {
		jest.useRealTimers()
	})

	function stored() {
		return db
			.select({ keptAt: notes.keptAt, status: notes.status, deletedAt: notes.deletedAt })
			.from(notes)
			.where(eq(notes.id, id))
			.get()
	}

	it('keeps a note now, and leaves its status alone', () => {
		changeNote(db, id, { kept: true })

		expect(stored()).toEqual({ keptAt, status: 'ready', deletedAt: null })
	})

	it('keeps the first time when a kept note is kept again', () => {
		changeNote(db, id, { kept: true })
		jest.setSystemTime(later)
		changeNote(db, id, { kept: true })

		expect(stored()?.keptAt).toEqual(keptAt)
	})

	it('takes a note out of Base, twice without an error', () => {
		changeNote(db, id, { kept: true })
		changeNote(db, id, { kept: false })
		changeNote(db, id, { kept: false })

		expect(stored()?.keptAt).toBeNull()
	})

	it('keeps the kept time through a change of something else', () => {
		changeNote(db, id, { kept: true })
		jest.setSystemTime(later)
		changeNote(db, id, { status: 'read' })

		expect(stored()).toMatchObject({ keptAt, status: 'read' })
	})

	it('answers 404 for a deleted note and leaves it unchanged', () => {
		deleteNote(db, id)

		const status = statusThrownBy(() => {
			changeNote(db, id, { kept: true })
		})

		expect([status, stored()?.keptAt]).toEqual([404, null])
	})
})
