// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { beforeEach, describe, expect, it } from 'bun:test'
import { faker } from '@faker-js/faker'
import { explanationRowFactory } from '#tests/factories/explanations'
import { noteRowFactory } from '#tests/factories/notes'
import { createTestDb, type TestDb } from '#tests/setup/db'
import { sql } from 'drizzle-orm'

import { selectFirstCards, type CardFlag } from './cards'
import { getNote, listNotes } from './list'

const capturedAt = new Date('2026-11-20T08:00:00Z')

function minutesAfter(minutes: number) {
	return new Date(capturedAt.getTime() + minutes * 60_000)
}

describe('the notes list', () => {
	let db: TestDb

	beforeEach(async () => {
		;({ db } = await createTestDb())
	})

	function listed() {
		return listNotes(db, {}).notes.map(({ id, sense, flag, snippet }) => ({
			id,
			sense,
			flag,
			snippet,
		}))
	}

	describe('card fields', () => {
		it('takes the sense and flag from the newest first-level card', async () => {
			const { id } = await noteRowFactory.transient({ db }).create()
			const cards = explanationRowFactory.transient({ db })
			const sense = faker.lorem.words(3)

			await cards.create({ noteId: id, body: { sense: 'old sense' }, createdAt: capturedAt })
			await cards.create({ noteId: id, body: { sense }, createdAt: minutesAfter(1) })
			// A deeper card is newer still, but a list row shows the first level only.
			await cards.create({
				noteId: id,
				depth: 2,
				body: { sense: 'deeper' },
				isDraft: true,
				createdAt: minutesAfter(2),
			})

			expect(listed()).toEqual([{ id, sense, flag: null, snippet: null }])
		})

		it('breaks a tie in time by the card id', async () => {
			const { id } = await noteRowFactory.transient({ db }).create()
			const cards = explanationRowFactory.transient({ db })

			await cards.create({ noteId: id, body: { sense: 'first' }, createdAt: capturedAt })
			await cards.create({ noteId: id, body: { sense: 'second' }, createdAt: capturedAt })

			expect(listed()[0]?.sense).toBe('second')
		})

		it.each<[string, { isDraft: boolean; isUncertain: boolean }, CardFlag | null]>([
			['a draft over an unsure answer', { isDraft: true, isUncertain: true }, 'draft'],
			['an unsure answer', { isDraft: false, isUncertain: true }, 'unsure'],
			['no flag on a sure card', { isDraft: false, isUncertain: false }, null],
		])('flags %s', async (_case, flags, flag) => {
			const { id } = await noteRowFactory.transient({ db }).create()

			await explanationRowFactory.transient({ db }).create({ noteId: id, ...flags })

			expect(listed()[0]?.flag).toBe(flag)
		})

		it.each([
			['no card', undefined],
			['a card without a sense', { summary: faker.lorem.sentence() }],
			['a blank sense', { sense: '  ' }],
			['a sense that is not text', { sense: 7 }],
		])('answers no sense for %s', async (_case, body) => {
			const { id } = await noteRowFactory.transient({ db }).create()

			if (body !== undefined) {
				await explanationRowFactory.transient({ db }).create({ noteId: id, body })
			}

			expect(listed()).toEqual([{ id, sense: null, flag: null, snippet: null }])
		})

		it('answers no total without a search', async () => {
			await noteRowFactory.transient({ db }).create()

			expect(listNotes(db, {}).total).toBeNull()
		})
	})

	describe('the card query', () => {
		it('reads the cards of a page through their note index', () => {
			const rows = db.all<{ detail: string }>(
				sql`EXPLAIN QUERY PLAN ${selectFirstCards(db, [1, 2, 3]).getSQL()}`,
			)

			expect(rows.map(({ detail }) => detail)).toEqual([
				'SEARCH explanations USING INDEX explanations_note_id_created_at_idx (note_id=?)',
			])
		})
	})

	describe('getNote', () => {
		it('answers a note by id', async () => {
			const note = await noteRowFactory.transient({ db }).create()

			expect(getNote(db, note.id)).toMatchObject({ id: note.id, text: note.text })
		})

		it('answers nothing for a deleted note or a missing one', async () => {
			const deleted = await noteRowFactory.transient({ db }).create({ deletedAt: capturedAt })

			expect([getNote(db, deleted.id), getNote(db, deleted.id + 1)]).toEqual([undefined, undefined])
		})
	})
})
