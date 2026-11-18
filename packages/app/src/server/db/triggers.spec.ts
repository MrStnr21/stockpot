// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import type { Database } from 'bun:sqlite'
import { beforeEach, describe, expect, it } from 'bun:test'
import { explanationRowFactory } from '#tests/factories/explanations'
import { noteRowFactory } from '#tests/factories/notes'
import { termRowFactory } from '#tests/factories/terms'
import { createTestDb, type TestDb } from '#tests/setup/db'
import { eq } from 'drizzle-orm'

import { explanations } from './schema/explanations'
import { notes, terms } from './schema/notes'

// The triggers hand-written at the end of the first migration (migrations/README.md).
describe('migration triggers', () => {
	describe('note_search', () => {
		let db: TestDb
		let sqlite: Database

		beforeEach(() => {
			;({ db, sqlite } = createTestDb())
		})

		function noteIdsMatching(query: string) {
			return sqlite
				.query<{ id: number }, [string]>(
					'SELECT rowid AS id FROM note_search WHERE note_search MATCH ? ORDER BY rowid',
				)
				.all(query)
				.map(({ id }) => id)
		}

		it('finds a new note by its text and by its context', async () => {
			const note = await noteRowFactory
				.transient({ db })
				.create({ text: 'Bun', context: 'seen in a podcast' })

			expect([noteIdsMatching('bun'), noteIdsMatching('podcast')]).toEqual([[note.id], [note.id]])
		})

		it('follows an edited note', async () => {
			const note = await noteRowFactory.transient({ db }).create({ text: 'Deno' })

			db.update(notes).set({ text: 'Bun' }).where(eq(notes.id, note.id)).run()

			expect([noteIdsMatching('deno'), noteIdsMatching('bun')]).toEqual([[], [note.id]])
		})

		it('forgets a deleted note', async () => {
			const note = await noteRowFactory.transient({ db }).create({ text: 'Bun' })

			db.delete(notes).where(eq(notes.id, note.id)).run()

			expect(sqlite.query('SELECT count(*) AS rows FROM note_search').get()).toEqual({ rows: 0 })
		})

		it("finds a note by its card's values, not by the keys of the card's format", async () => {
			const note = await noteRowFactory.transient({ db }).create({ text: 'Bun' })

			await explanationRowFactory.transient({ db }).create({
				noteId: note.id,
				body: { summary: 'A JavaScript runtime', links: ['zig'] },
			})

			expect([
				noteIdsMatching('runtime'),
				noteIdsMatching('zig'),
				noteIdsMatching('summary'),
			]).toEqual([[note.id], [note.id], []])
		})

		it('follows an edited card', async () => {
			const note = await noteRowFactory.transient({ db }).create({ text: 'Bun' })

			const card = await explanationRowFactory
				.transient({ db })
				.create({ noteId: note.id, body: { summary: 'A bundler' } })

			db.update(explanations)
				.set({ body: { summary: 'A runtime' } })
				.where(eq(explanations.id, card.id))
				.run()

			expect([noteIdsMatching('bundler'), noteIdsMatching('runtime')]).toEqual([[], [note.id]])
		})

		it('moves card text with a card that moves to another note', async () => {
			const [first, second] = await noteRowFactory.transient({ db }).createList(2)

			const card = await explanationRowFactory
				.transient({ db })
				.create({ noteId: first.id, body: { summary: 'A runtime' } })

			db.update(explanations).set({ noteId: second.id }).where(eq(explanations.id, card.id)).run()

			expect(noteIdsMatching('runtime')).toEqual([second.id])
		})

		it('forgets a deleted card', async () => {
			const note = await noteRowFactory.transient({ db }).create({ text: 'Bun' })

			const card = await explanationRowFactory
				.transient({ db })
				.create({ noteId: note.id, body: { summary: 'A runtime' } })

			db.delete(explanations).where(eq(explanations.id, card.id)).run()

			expect([noteIdsMatching('runtime'), noteIdsMatching('bun')]).toEqual([[], [note.id]])
		})

		it('forgets the cards of a deleted note', async () => {
			const note = await noteRowFactory.transient({ db }).create({ text: 'Bun' })

			await explanationRowFactory.transient({ db }).create({ noteId: note.id })
			db.delete(notes).where(eq(notes.id, note.id)).run()

			expect(sqlite.query('SELECT count(*) AS rows FROM note_search').get()).toEqual({ rows: 0 })
		})
	})

	describe('deleting a term', () => {
		let db: TestDb

		beforeEach(() => {
			;({ db } = createTestDb())
		})

		it('deletes the cards written for the term alone and keeps the note cards', async () => {
			const bun = await termRowFactory.transient({ db }).create({ term: 'bun' })
			const note = await noteRowFactory.transient({ db }).create({ text: 'Bun', termId: bun.id })

			const [, noteCard] = await Promise.all([
				explanationRowFactory.transient({ db }).create({ termId: bun.id }),
				explanationRowFactory.transient({ db }).create({ termId: bun.id, noteId: note.id }),
			])

			db.delete(terms).where(eq(terms.id, bun.id)).run()

			const cards = db
				.select({ id: explanations.id, noteId: explanations.noteId, termId: explanations.termId })
				.from(explanations)
				.all()

			expect(cards).toEqual([{ id: noteCard.id, noteId: note.id, termId: null }])
		})
	})
})
