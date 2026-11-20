// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { describe, expect, it } from 'bun:test'
import { faker } from '@faker-js/faker'
import { newNoteFactory } from '#tests/factories/notes'
import * as v from 'valibot'

import { encodeCursor, newNoteSchema, notesQuerySchema } from './schemas'

describe('notes schemas', () => {
	describe('newNoteSchema', () => {
		it.each([
			['an empty note', { text: '   ' }],
			['a note over 1000 characters', { text: faker.string.alpha(1001) }],
			['context over 4000 characters', { context: faker.string.alpha(4001) }],
			['a URL that is not http or https', { url: 'ftp://example.com/notes.txt' }],
			['text that is not a URL', { url: faker.word.noun() }],
			['a URL over 2048 characters', { url: `https://example.com/${faker.string.alpha(2030)}` }],
			['an unknown source', { source: 'email' }],
		])('refuses %s', (_case, fields) => {
			expect(v.safeParse(newNoteSchema, newNoteFactory.build(fields)).success).toBe(false)
		})

		it('takes 1000 characters of text, 4000 of context and a 2048-character URL', () => {
			const url = `https://example.com/${faker.string.alpha(2028)}`

			const note = newNoteFactory.build({
				text: faker.string.alpha(1000),
				context: faker.string.alpha(4000),
				url,
			})

			expect(v.safeParse(newNoteSchema, note).success).toBe(true)
		})
	})

	describe('notesQuerySchema', () => {
		it('reads back the cursor it made', () => {
			const createdAt = faker.date.recent()
			const id = faker.number.int({ min: 1, max: 10_000 })
			const query = v.parse(notesQuerySchema, { cursor: encodeCursor({ createdAt, id }) })

			expect(query.cursor).toEqual({ createdAt: createdAt.getTime(), id })
		})
	})
})
