// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { beforeEach, describe, expect, it } from 'bun:test'
import { faker } from '@faker-js/faker'
import { categoryRowFactory } from '#tests/factories/categories'
import { newNoteFactory, noteRowFactory } from '#tests/factories/notes'
import { createTestDb, type TestDb } from '#tests/setup/db'
import { sql } from 'drizzle-orm'
import * as v from 'valibot'

import type { NoteStatus } from '#/server/db/schema/notes'
import { HttpError } from '#/server/http'

import {
	changeNote,
	createNote,
	deleteNote,
	listNotes,
	newNoteSchema,
	notesQuerySchema,
	selectNotes,
	type NotesQuery,
	type PublicNote,
} from './server'

/** The JSON error an action throws, with its status, or null when it throws none. */
function errorOf(action: (() => PublicNote) | (() => void)) {
	try {
		action()
	} catch (error) {
		if (error instanceof HttpError) {
			return { status: error.status, ...error.details }
		}

		throw error
	}

	return null
}

const capturedAt = new Date('2026-11-20T08:00:00Z')

describe('notes', () => {
	let db: TestDb

	beforeEach(async () => {
		;({ db } = await createTestDb())
	})

	/** Saves a note the way POST /api/notes does, from a request body. */
	function create(fields: Parameters<typeof newNoteFactory.build>[0] = {}) {
		return createNote(db, v.parse(newNoteSchema, newNoteFactory.build(fields)))
	}

	async function noteWithStatus(status: NoteStatus) {
		return noteRowFactory.transient({ db }).create({ status })
	}

	function listedIds(query: NotesQuery = {}) {
		return listNotes(db, query).notes.map(({ id }) => id)
	}

	describe('createNote', () => {
		it('saves the trimmed note with status new and the defaults, and answers with it', () => {
			const text = faker.word.noun()
			const note = create({ text: `  ${text}  `, context: '  ', url: null })

			const saved = { text, context: null, url: null, source: 'web', categoryId: null }

			expect([note, listedIds()]).toMatchObject([
				{ ...saved, status: 'new', private: false },
				[note.id],
			])
		})

		it('saves the category, the source and privacy as given', async () => {
			const category = await categoryRowFactory.transient({ db }).create()
			const note = create({ categoryId: category.id, source: 'shortcut', private: true })

			expect(note).toMatchObject({ categoryId: category.id, source: 'shortcut', private: true })
		})

		it('answers 400 naming categoryId for a category that does not exist, and saves nothing', () => {
			expect([errorOf(() => create({ categoryId: 404 })), listedIds()]).toEqual([
				{
					status: 400,
					code: 'invalid_body',
					message: 'The body does not match what this route accepts.',
					issues: ['categoryId: There is no such category.'],
				},
				[],
			])
		})
	})

	describe('listNotes', () => {
		it('lists newest first and leaves deleted notes out', async () => {
			const notes = noteRowFactory.transient({ db })
			const older = await notes.create({ createdAt: new Date(capturedAt.getTime() - 1000) })
			const deleted = await notes.create({ createdAt: capturedAt, deletedAt: capturedAt })
			const newer = await notes.create({ createdAt: capturedAt })

			expect([listedIds(), listedIds().includes(deleted.id)]).toEqual([[newer.id, older.id], false])
		})

		it('filters by status', async () => {
			const notes = noteRowFactory.transient({ db })
			const [ready] = await Promise.all([notes.create({ status: 'ready' }), notes.create()])

			expect(listedIds({ status: 'ready' })).toEqual([ready.id])
		})

		it('filters by category', async () => {
			const category = await categoryRowFactory.transient({ db }).create()
			const notes = noteRowFactory.transient({ db })
			const [filed] = await Promise.all([notes.create({ categoryId: category.id }), notes.create()])

			expect(listedIds({ categoryId: category.id })).toEqual([filed.id])
		})

		it('pages through every note with the cursor, breaking ties in time by id', async () => {
			const notes = noteRowFactory.transient({ db })
			const earlier = await notes.createList(2, { createdAt: new Date(capturedAt.getTime() - 1) })
			const sameTime = await notes.createList(3, { createdAt: capturedAt })
			const pages: number[][] = []
			let cursor: string | null | undefined

			do {
				const query = v.parse(notesQuerySchema, { limit: '2', cursor: cursor ?? undefined })
				const page = listNotes(db, query)

				pages.push(page.notes.map(({ id }) => id))
				cursor = page.nextCursor
				// A cursor that never ran out would loop forever; three pages hold every note.
			} while (cursor !== null && pages.length < 4)

			expect(pages).toEqual([
				[sameTime[2]?.id, sameTime[1]?.id],
				[sameTime[0]?.id, earlier[1]?.id],
				[earlier[0]?.id],
			])
		})

		it('answers 50 notes a page by default', async () => {
			await noteRowFactory.transient({ db }).createList(51)

			const page = listNotes(db, {})

			expect([page.notes.length, page.nextCursor === null]).toEqual([50, false])
		})
	})

	describe('the list query', () => {
		const cursor = { createdAt: capturedAt.getTime(), id: 7 }

		/* A plan without "USE TEMP B-TREE" reads the rows in index order instead of sorting them; the
		 * id needs no index column of its own, because every SQLite index ends with the rowid. */
		it.each<[string, NotesQuery, string]>([
			['every note', {}, 'SCAN notes USING INDEX notes_created_at_idx'],
			[
				'every note after a cursor',
				{ cursor },
				'SEARCH notes USING INDEX notes_created_at_idx (created_at<?)',
			],
			[
				'a status',
				{ status: 'ready' },
				'SEARCH notes USING INDEX notes_status_created_at_idx (status=?)',
			],
			[
				'a status after a cursor',
				{ status: 'ready', cursor },
				'SEARCH notes USING INDEX notes_status_created_at_idx (status=? AND created_at<?)',
			],
			[
				'a category',
				{ categoryId: 1 },
				'SEARCH notes USING INDEX notes_category_id_created_at_idx (category_id=?)',
			],
			[
				'a category after a cursor',
				{ categoryId: 1, cursor },
				'SEARCH notes USING INDEX notes_category_id_created_at_idx (category_id=? AND created_at<?)',
			],
		])('reads %s through its index', (_filter, query, plan) => {
			const rows = db.all<{ detail: string }>(
				sql`EXPLAIN QUERY PLAN ${selectNotes(db, query).getSQL()}`,
			)

			expect(rows.map(({ detail }) => detail)).toEqual([plan])
		})
	})

	describe('changeNote', () => {
		it.each<[NoteStatus, NoteStatus]>([
			['ready', 'read'],
			['read', 'ready'],
			['new', 'archived'],
			['ready', 'archived'],
			['read', 'archived'],
			['failed', 'archived'],
		])('sets a note with status %s to %s', async (from, to) => {
			const { id } = await noteWithStatus(from)

			expect(changeNote(db, id, { status: to }).status).toBe(to)
		})

		it.each<[NoteStatus, NoteStatus]>([
			['new', 'read'],
			['new', 'ready'],
			['read', 'read'],
			['archived', 'ready'],
			['archived', 'new'],
			['queued', 'archived'],
			['researching', 'archived'],
			['ready', 'queued'],
			['new', 'researching'],
			['read', 'failed'],
		])('answers 409 to setting %s to %s, and keeps the status', async (from, to) => {
			const { id } = await noteWithStatus(from)

			expect([
				errorOf(() => changeNote(db, id, { status: to })),
				listNotes(db, {}).notes[0]?.status,
			]).toEqual([
				{
					status: 409,
					code: 'status_conflict',
					message: `A note with status ${from} cannot be set to ${to}.`,
				},
				from,
			])
		})

		it('sets the category and clears it', async () => {
			const category = await categoryRowFactory.transient({ db }).create()
			const { id } = await noteRowFactory.transient({ db }).create()

			const filed = changeNote(db, id, { categoryId: category.id })
			const cleared = changeNote(db, id, { categoryId: null })

			expect([filed.categoryId, cleared.categoryId]).toEqual([category.id, null])
		})

		it('answers 400 for a category that does not exist', async () => {
			const { id } = await noteRowFactory.transient({ db }).create()

			expect(errorOf(() => changeNote(db, id, { categoryId: 404 }))).toMatchObject({
				status: 400,
				issues: ['categoryId: There is no such category.'],
			})
		})

		it('answers 404 for a note that does not exist', () => {
			expect(errorOf(() => changeNote(db, 404, { status: 'read' }))?.status).toBe(404)
		})
	})

	describe('deleteNote', () => {
		describe('on a note', () => {
			let id: number

			beforeEach(async () => {
				;({ id } = await noteRowFactory.transient({ db }).create({ status: 'ready' }))
				deleteNote(db, id)
			})

			it('leaves it out of every list', () => {
				expect([listedIds(), listedIds({ status: 'ready' })]).toEqual([[], []])
			})

			it('answers 404 to a change and to a second delete', () => {
				expect([
					errorOf(() => changeNote(db, id, { status: 'read' }))?.status,
					errorOf(() => {
						deleteNote(db, id)
					})?.status,
				]).toEqual([404, 404])
			})

			it('restores it with deleted: false, together with a change', () => {
				const restored = changeNote(db, id, { deleted: false, status: 'read' })

				expect([restored.status, listedIds()]).toEqual(['read', [id]])
			})
		})

		it('answers 404 for a note that does not exist', () => {
			const error = errorOf(() => {
				deleteNote(db, 404)
			})

			expect(error?.status).toBe(404)
		})
	})
})
