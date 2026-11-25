// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { beforeEach, describe, expect, it } from 'bun:test'
import { noteRowFactory } from '#tests/factories/notes'
import { createTestDb, type TestDb } from '#tests/setup/db'
import { eq } from 'drizzle-orm'

import { notes } from '#/server/db/schema/notes'
import type { ResearchProgress } from '#/server/engines/contract'

import { createProgressBoard, researchState, type ProgressBoard } from './ideas'

const searching: ResearchProgress = { step: 'searching', questions: 4, searched: 2, pages: 7 }

describe('research progress', () => {
	let db: TestDb
	let board: ProgressBoard

	beforeEach(async () => {
		;({ db } = await createTestDb())
		board = createProgressBoard()
	})

	describe('the board', () => {
		it('holds the latest progress of a note, and nothing for another', () => {
			board.set(1, { step: 'planning', questions: 0, searched: 0, pages: 0 })
			board.set(1, searching)

			expect([board.get(1), board.get(2)]).toEqual([searching, null])
		})

		it('keeps the four counts and nothing else a caller adds', () => {
			const noisy = { ...searching, question: 'What exists?' }

			board.set(1, noisy)

			expect(board.get(1)).toEqual(searching)
		})

		it('forgets a note once it is cleared, and only that note', () => {
			board.set(1, searching)
			board.set(2, searching)
			board.clear(1)

			expect([board.get(1), board.get(2)]).toEqual([null, searching])
		})
	})

	describe('researchState', () => {
		it('gives a researching idea its status and progress', async () => {
			const note = await noteRowFactory.transient({ db }).create({ status: 'researching' })

			board.set(note.id, searching)

			expect(researchState(db, board, note.id)).toEqual({
				id: note.id,
				status: 'researching',
				progress: searching,
			})
		})

		it('gives a note with no progress a null one', async () => {
			const note = await noteRowFactory.transient({ db }).create()

			expect(researchState(db, board, note.id)).toEqual({
				id: note.id,
				status: 'new',
				progress: null,
			})
		})

		it('gives nothing for a missing note, or a deleted one with progress', async () => {
			const note = await noteRowFactory.transient({ db }).create()

			board.set(note.id, searching)
			db.update(notes).set({ deletedAt: new Date() }).where(eq(notes.id, note.id)).run()

			expect([researchState(db, board, note.id), researchState(db, board, note.id + 1)]).toEqual([
				null,
				null,
			])
		})
	})
})
