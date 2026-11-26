// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import type { Database } from 'bun:sqlite'
import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test'
import { faker } from '@faker-js/faker'
import { storedBody } from '#tests/factories/card-bodies'
import { categoryRowFactory } from '#tests/factories/categories'
import { explanationRowFactory } from '#tests/factories/explanations'
import { jobRowFactory } from '#tests/factories/jobs'
import { noteRowFactory } from '#tests/factories/notes'
import { createTestDb, type TestDb } from '#tests/setup/db'
import { eq, sql, type SQLWrapper } from 'drizzle-orm'
import * as v from 'valibot'

import { cardViewSchema } from '#/features/research/shared/card-view'
import { youglishUrl } from '#/features/research/shared/youglish'
import { explanations } from '#/server/db/schema/explanations'
import { categories, notes } from '#/server/db/schema/notes'
import { log } from '#/server/log'

import { readCardView, selectCardNote, selectNoteCards } from './card-view'
import { createProgressBoard, type ProgressBoard } from './ideas'

const now = new Date('2026-11-19T09:00:00Z')

const earlier = new Date('2026-11-19T06:30:00Z')

describe('readCardView', () => {
	let sqlite: Database
	let db: TestDb
	let board: ProgressBoard
	let noteId: number
	let categoryId: number
	let context: string | null
	let categoryName: string
	let warn: ReturnType<typeof spyOn<typeof log, 'warn'>>

	beforeEach(async () => {
		;({ sqlite, db } = await createTestDb())
		board = createProgressBoard()
		warn = spyOn(log, 'warn').mockImplementation(() => {
			// Keep the expected warnings out of the test log.
		})

		const category = await categoryRowFactory
			.transient({ db })
			.create({ format: 'vocabulary', color: 'english', icon: 'english' })

		const note = await noteRowFactory
			.transient({ db })
			.create({ text: 'serendipity', categoryId: category.id, status: 'ready' })

		;({ id: noteId, context } = note)
		;({ id: categoryId, name: categoryName } = category)
	})

	afterEach(() => {
		mock.restore()
		sqlite.close()
	})

	function read() {
		return readCardView(db, board, { noteId, now })
	}

	// Inserted by hand: the row factory would merge its own sample body into this one.
	function card(depth: 1 | 2 | 3, values: Partial<typeof explanations.$inferInsert> = {}) {
		const row = {
			...explanationRowFactory.build(),
			noteId,
			format: 'vocabulary',
			depth,
			body: storedBody('vocabulary', depth),
			engine: 'gemini',
			createdAt: earlier,
			...values,
		}

		return db.insert(explanations).values(row).returning().get()
	}

	function plan(query: SQLWrapper) {
		return db
			.all<{ detail: string }>(sql`EXPLAIN QUERY PLAN ${query.getSQL()}`)
			.map(({ detail }) => detail)
	}

	it('reads the note by primary key and its category by primary key', () => {
		expect(plan(selectCardNote(db, noteId))).toEqual([
			'SEARCH notes USING INTEGER PRIMARY KEY (rowid=?)',
			'SEARCH categories USING INTEGER PRIMARY KEY (rowid=?) LEFT-JOIN',
		])
	})

	it("reads the note's cards through explanations_note_id_created_at_idx", () => {
		expect(plan(selectNoteCards(db, noteId))).toEqual([
			'SEARCH explanations USING INDEX explanations_note_id_created_at_idx (note_id=?)',
		])
	})

	it('is null for a missing or deleted note', () => {
		expect(readCardView(db, board, { noteId: noteId + 1, now })).toBeNull()

		db.update(notes).set({ deletedAt: now }).where(eq(notes.id, noteId)).run()

		expect(read()).toBeNull()
	})

	it('shows a note without a card in its category format, with nothing written yet', () => {
		db.update(notes).set({ status: 'new', keptAt: now }).where(eq(notes.id, noteId)).run()

		expect(read()).toEqual({
			note: {
				id: noteId,
				text: 'serendipity',
				context,
				status: 'new',
				isPrivate: false,
				isKept: true,
			},
			category: { id: categoryId, name: categoryName, color: 'english', icon: 'english' },
			format: 'vocabulary',
			levelSet: 'word',
			sense: null,
			facts: null,
			readingMinutes: null,
			levels: [
				{ depth: 1, job: null, card: null },
				{ depth: 2, job: null, card: null },
				{ depth: 3, job: null, card: null },
			],
			research: { job: null, progress: null, failure: null },
		})
	})

	it('reads an English card with its facts, YouGlish link and reading time, in the shared schema', async () => {
		card(1, { sources: [{ title: 'A dictionary', url: 'https://example.com/word' }] })

		const view = read()

		expect(v.safeParse(cardViewSchema, view).issues).toBeUndefined()
		expect([view?.sense, view?.readingMinutes]).toEqual(['A lucky accident', 1])
		expect(view?.facts).toEqual({
			partOfSpeech: 'noun',
			difficulty: 'medium',
			youglish: youglishUrl('serendipity'),
		})
		expect(view?.levels[0].card).toMatchObject({
			sources: [{ title: 'A dictionary', url: 'https://example.com/word' }],
			isDraft: false,
			engine: 'gemini',
			createdAt: earlier.toISOString(),
			redoAt: null,
		})
		expect(view?.levels[0].card?.blocks?.map(({ heading }) => heading)).toEqual([
			'translation',
			'examples',
			'modelSentences',
			'mistake',
		])
	})

	it('gives a private note no YouGlish link', async () => {
		db.update(notes).set({ isPrivate: true }).where(eq(notes.id, noteId)).run()
		card(1)

		expect(read()?.facts).toMatchObject({ youglish: null })
	})

	it('drops a stored source that is not an HTTP(S) page', async () => {
		card(1, {
			sources: [
				// oxlint-disable-next-line eslint/no-script-url -- The spec checks that such a link is dropped.
				{ title: 'Script', url: 'javascript:alert(1)' },
				{ title: 'Docs', url: 'https://example.com/docs' },
			],
		})

		expect(read()?.levels[0].card?.sources).toEqual([
			{ title: 'Docs', url: 'https://example.com/docs' },
		])
	})

	it('reads stored sources that are not JSON as no sources, and the card as usual', async () => {
		const { id } = card(1)

		sqlite.run("UPDATE explanations SET sources = 'oops' WHERE id = ?", [id])

		const level = read()?.levels[0].card

		expect([level?.sources, level?.blocks?.[0]?.kind]).toEqual([[], 'text'])
	})

	it('shows the newest card of each depth, and the higher id at the same time', async () => {
		card(1, { isDraft: true, createdAt: new Date('2026-11-18T06:30:00Z') })
		card(1, { engine: 'openai-compatible' })
		const newest = card(1, { engine: 'agent-command' })
		card(2, { createdAt: new Date('2026-11-20T06:30:00Z') })

		const view = read()

		expect(view?.levels[0].card).toMatchObject({ engine: newest.engine, isDraft: false })
		expect(view?.levels.map(({ card: level }) => level !== null)).toEqual([true, true, false])
	})

	it('dates the redo of a draft with its level job', async () => {
		card(1, { isDraft: true })

		const redo = await jobRowFactory
			.transient({ db })
			.create({ kind: 'research', payload: { noteId }, runAt: new Date('2026-11-19T14:00:00Z') })

		const view = read()

		expect(view?.levels[0].card?.redoAt).toBe(redo.runAt.toISOString())
		expect(view?.research.job).toEqual(view?.levels[0].job ?? null)
	})

	it("keeps the card's format after the category changes to another one", async () => {
		card(1)
		db.update(categories).set({ format: 'technology' }).where(eq(categories.id, categoryId)).run()

		expect(read()).toMatchObject({ format: 'vocabulary', levelSet: 'word' })
	})

	it('reads a body that no longer fits as no blocks, and logs it once', async () => {
		// An id no other spec uses: a card is reported once per process.
		card(1, {
			id: faker.number.int({ min: 1_000_000, max: 2_000_000_000 }),
			body: { sense: 'A lucky accident', translation: 'luck' },
		})

		read()
		const view = read()

		expect(view).toMatchObject({ sense: 'A lucky accident', facts: null, readingMinutes: null })
		expect(view?.levels[0].card?.blocks).toBeNull()
		expect(warn).toHaveBeenCalledTimes(1)
		expect(warn).toHaveBeenCalledWith('A stored card does not fit its format', {
			noteId,
			depth: 1,
			format: 'vocabulary',
		})
	})

	it('reads the last failure of a failed note', async () => {
		db.update(notes).set({ status: 'failed' }).where(eq(notes.id, noteId)).run()
		await jobRowFactory.transient({ db }).create({
			kind: 'research',
			status: 'failed',
			payload: { noteId },
			attempts: 3,
			lastError: 'The engine failed: invalid',
			finishedAt: earlier,
		})

		expect(read()?.research.failure).toEqual({
			kind: 'invalid',
			attempts: 3,
			at: earlier.toISOString(),
		})
	})

	it("shows an idea's progress from the board", () => {
		const progress = { step: 'searching', questions: 4, searched: 2, pages: 9 } as const

		board.set(noteId, progress)

		expect(read()?.research.progress).toEqual(progress)
	})
})
