// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { beforeEach, describe, expect, it } from 'bun:test'
import { faker } from '@faker-js/faker'
import { categoryRowFactory } from '#tests/factories/categories'
import { newNoteFactory, noteRowFactory } from '#tests/factories/notes'
import { aliasRowFactory, termRowFactory } from '#tests/factories/terms'
import { createTestDb, type TestDb } from '#tests/setup/db'
import * as v from 'valibot'

import { notes, terms } from '#/server/db/schema/notes'
import { HttpError } from '#/server/http'

import { createNote, newNoteSchema } from './server'

/** The JSON error an action throws, with its status, or null when it throws none. */
function errorOf(action: () => ReturnType<typeof createNote>) {
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

describe('createNote', () => {
	let db: TestDb

	beforeEach(async () => {
		;({ db } = await createTestDb())
	})

	/** Saves a note the way POST /api/notes does, from a request body. */
	function create(fields: Parameters<typeof newNoteFactory.build>[0] = {}) {
		return createNote(db, v.parse(newNoteSchema, newNoteFactory.build(fields)))
	}

	function storedNotes() {
		return db.select().from(notes).orderBy(notes.id).all()
	}

	it('saves the trimmed note with status new and the defaults, and answers with it', () => {
		const text = faker.word.noun()
		const { note, merged } = create({ text: `  ${text}  `, context: '  ', url: null })
		const saved = { text, context: null, url: null, source: 'web', categoryId: null }

		expect([merged, note, storedNotes()]).toMatchObject([
			false,
			{ ...saved, status: 'new', private: false },
			[{ id: note.id }],
		])
	})

	it('saves the category, the source and privacy as given and assigns the term category', async () => {
		const category = await categoryRowFactory.transient({ db }).create()
		const { note } = create({ categoryId: category.id, source: 'shortcut', private: true })

		expect(note).toMatchObject({ categoryId: category.id, source: 'shortcut', private: true })
		expect(db.select().from(terms).all()).toMatchObject([{ categoryId: category.id }])
	})

	it('answers 400 naming categoryId for a category that does not exist, and saves nothing', () => {
		expect([errorOf(() => create({ categoryId: 404 })), storedNotes()]).toEqual([
			{
				status: 400,
				code: 'invalid_body',
				message: 'The body does not match what this route accepts.',
				issues: ['categoryId: There is no such category.'],
			},
			[],
		])
		expect(db.select().from(terms).all()).toEqual([])
	})

	it.each([
		['Queries!', 'Query', 'queries'],
		['K8s', 'Kubernetes', 'k8s'],
	])('stores %s as typed and reuses its term and note for %s', (text, repeat, term) => {
		const first = create({ text })
		const second = create({ text: repeat })

		expect([first.merged, second]).toMatchObject([
			false,
			{ merged: true, note: { id: first.note.id, text } },
		])
		expect(db.select().from(terms).all()).toMatchObject([
			{ id: storedNotes()[0]?.termId, term, meaning: '' },
		])
		expect(storedNotes()).toHaveLength(1)
	})

	it('links a learned alias to its term and inserts a separate note', async () => {
		const { id: termId, term } = await termRowFactory
			.transient({ db })
			.create({ term: 'container' })

		const first = create({ text: term })
		const { alias } = await aliasRowFactory.transient({ db }).create({ termId, alias: 'vessel' })
		const second = create({ text: alias })

		expect(second).toMatchObject({ merged: false, note: { text: alias } })
		expect(storedNotes()).toMatchObject([
			{ id: first.note.id, termId, context: first.note.context },
			{ id: second.note.id, termId, context: second.note.context },
		])
	})

	it.each([null, 'filed'] as const)(
		'picks the only sense matching category %s',
		async (category) => {
			const { id } = await categoryRowFactory.transient({ db }).create()
			const categoryId = category === null ? null : id
			const senses = termRowFactory.transient({ db }).params({ term: 'cache' })
			const chosen = await senses.create({ meaning: 'a hidden supply', categoryId })
			await senses.create({ meaning: 'stored results', categoryId: category === null ? id : null })

			expect(create({ text: 'Cache', categoryId }).merged).toBe(false)
			expect(storedNotes()).toMatchObject([{ termId: chosen.id, categoryId }])
		},
	)

	it.each([false, true])(
		'uses the typed empty-meaning row when sense choice is ambiguous (existing row: %s)',
		async (existing) => {
			const { id: categoryId } = await categoryRowFactory.transient({ db }).create()
			const senses = termRowFactory.transient({ db }).params({ term: 'query', categoryId })
			await senses.create({ meaning: 'request' })
			await senses.create({ meaning: 'question' })
			const unknown = existing ? await senses.create({ term: 'queries', meaning: '' }) : undefined
			const { merged } = create({ text: 'Queries', categoryId })
			const stored = db.select().from(terms).orderBy(terms.id).all()

			expect(merged).toBe(false)
			expect(stored).toHaveLength(3)
			expect(stored.at(-1)).toMatchObject({
				id: unknown?.id ?? storedNotes()[0]?.termId,
				term: 'queries',
				meaning: '',
				categoryId,
			})
			expect(storedNotes()).toMatchObject([{ termId: stored.at(-1)?.id }])
		},
	)

	it('appends context, fills missing fields, and keeps the original capture and status', async () => {
		const { id: categoryId } = await categoryRowFactory.transient({ db }).create()
		const { id: termId, term } = await termRowFactory.transient({ db }).create({ term: 'cache' })

		const first = await noteRowFactory.transient({ db }).create({
			termId,
			text: 'Cache',
			source: 'shortcut',
			status: 'ready',
			isPrivate: true,
			updatedAt: capturedAt,
		})

		const capture = newNoteFactory.build({ text: term, categoryId, private: true })
		const result = create(capture)

		expect(result).toMatchObject({
			merged: true,
			note: {
				id: first.id,
				text: first.text,
				source: first.source,
				status: first.status,
				private: true,
				createdAt: first.createdAt,
				url: capture.url,
				categoryId,
				context: `${first.context}\n\n${capture.context}`,
			},
		})
		expect(result.note.updatedAt.getTime()).toBeGreaterThan(first.updatedAt.getTime())
		expect(db.select().from(terms).all()).toMatchObject([{ id: termId, categoryId }])
	})

	it.each(['duplicate', 'empty', 'null'] as const)(
		'keeps populated fields when the new context is %s',
		async (kind) => {
			const [{ id: categoryId }, { id: otherCategory }] = await categoryRowFactory
				.transient({ db })
				.createList(2)

			const first = create({ categoryId })

			const contexts = {
				duplicate: first.note.context?.split(' ')[0] ?? null,
				empty: '',
				null: null,
			}

			const second = create({
				text: first.note.text,
				context: contexts[kind],
				categoryId: otherCategory,
			})

			expect(second).toMatchObject({
				merged: true,
				note: {
					id: first.note.id,
					context: first.note.context,
					url: first.note.url,
					categoryId,
				},
			})
			expect(db.select().from(terms).all()).toMatchObject([{ categoryId }])
		},
	)

	it.each([4000, 4001])(
		'preserves both contexts when appending would use %i characters',
		(length) => {
			const context = `${faker.word.noun()} 2`
			const original = faker.string.alpha(length - context.length - 2)
			const first = create({ context: original })
			const second = create({ text: first.note.text, context })
			const fits = length === 4000

			expect(second.merged).toBe(fits)
			expect(storedNotes().map((note) => note.context)).toEqual(
				fits ? [`${original}\n\n${context}`] : [original, context],
			)
		},
	)

	it.each([true, false])(
		'keeps separate notes across the privacy flag (first private: %s)',
		(isPrivate) => {
			const first = create({ private: isPrivate })
			const second = create({ text: first.note.text, private: !isPrivate })
			const repeat = create({ text: first.note.text, private: !isPrivate })

			expect([second, repeat, storedNotes()]).toMatchObject([
				{ merged: false, note: { private: !isPrivate } },
				{ merged: true, note: { id: second.note.id } },
				[{ id: first.note.id, context: first.note.context }, { id: second.note.id }],
			])
		},
	)

	it.each<[string, Parameters<typeof noteRowFactory.build>[0]]>([
		['read', { status: 'read' }],
		['shown', { firstShownAt: capturedAt }],
		['archived', { status: 'archived' }],
		['deleted', { deletedAt: capturedAt }],
	])('inserts a new note when the existing note is %s', async (_case, fields) => {
		const { id: termId, term } = await termRowFactory.transient({ db }).create()
		const first = await noteRowFactory.transient({ db }).create({ ...fields, text: term, termId })
		const second = create({ text: term })

		expect(second.merged).toBe(false)
		expect(storedNotes()).toMatchObject([
			{ id: first.id, termId, context: first.context },
			{ id: second.note.id, termId },
		])
	})

	it.each(['long', 'punctuation only'])('saves a %s capture without a term', (kind) => {
		const text = kind === 'long' ? faker.string.alpha(81) : '!?,.'

		expect(create({ text }).merged).toBe(false)
		expect(storedNotes()).toMatchObject([{ text, termId: null }])
		expect(db.select().from(terms).all()).toEqual([])
	})
})
