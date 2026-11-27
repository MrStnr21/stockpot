// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { describe, expect, it } from 'bun:test'
import { faker } from '@faker-js/faker'
import { newNoteFactory } from '#tests/factories/notes'
import * as v from 'valibot'

import {
	baseNotesQuerySchema,
	encodeCursor,
	newNoteSchema,
	noteChangeSchema,
	notesQuerySchema,
} from './schemas'

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

	describe('baseNotesQuerySchema', () => {
		it.each([
			['a category', { categoryId: '7' }, { categoryId: 7 }],
			['the uncategorized notes', { categoryId: 'none' }, { categoryId: null }],
			['a search with a page size', { q: ' run ', limit: '100' }, { q: 'run', limit: 100 }],
		])('takes %s', (_case, params, query) => {
			expect(v.parse(baseNotesQuerySchema, params)).toEqual(query)
		})

		it.each([
			['both a category and a search', { categoryId: '7', q: 'run' }],
			['neither a category nor a search', {}],
			['only a blank search', { q: '   ' }],
			['a category that is not an id', { categoryId: 'all' }],
			['a page over 100', { q: 'run', limit: '101' }],
			['a cursor it did not make', { categoryId: 'none', cursor: 'not-a-cursor' }],
		])('refuses %s', (_case, params) => {
			expect(v.safeParse(baseNotesQuerySchema, params).success).toBe(false)
		})
	})

	describe('noteChangeSchema', () => {
		it.each([{ kept: true }, { kept: false }, { kept: true, status: 'read' }])(
			'takes %p',
			(change) => {
				expect(v.safeParse(noteChangeSchema, change).success).toBe(true)
			},
		)

		it('refuses an empty change and names every field it takes', () => {
			const issues = v.safeParse(noteChangeSchema, {}).issues?.map(({ message }) => message)

			expect(issues).toEqual(['Change categoryId, status, deleted or kept.'])
		})

		it('refuses kept that is not a boolean', () => {
			expect(v.safeParse(noteChangeSchema, { kept: 'yes' }).success).toBe(false)
		})
	})
})
