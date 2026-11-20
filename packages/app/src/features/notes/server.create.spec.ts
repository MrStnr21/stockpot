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

	it('rejects a missing category before saving a term or note', () => {
		expect(() => create({ categoryId: 404 })).toThrow(HttpError)
		expect(storedNotes()).toEqual([])
		expect(db.select().from(terms).all()).toEqual([])
	})

	it.each([
		['Queries!', 'Query', 'queries'],
		['K8s', 'Kubernetes', 'k8s'],
		['lone\uD800 best practices', 'lone\uD800 best practices', 'lone� best practices'],
	])('stores %s as typed and reuses its term and note for %s', (text, repeat, term) => {
		const first = create({ text })
		const second = create({ text: repeat })

		expect([first.merged, second]).toMatchObject([
			false,
			{ merged: true, note: { id: first.note.id, text: first.note.text } },
		])
		expect(db.select().from(terms).all()).toMatchObject([
			{ id: storedNotes()[0]?.termId, term, meaning: '' },
		])
		expect(storedNotes()).toHaveLength(1)
	})

	it('keeps saves for a learned alias separate from its owner', async () => {
		const owner = await termRowFactory.transient({ db }).create({ term: 'gizmo' })

		const { alias } = await aliasRowFactory
			.transient({ db })
			.create({ termId: owner.id, alias: 'widget' })

		const { id: categoryId } = await categoryRowFactory.transient({ db }).create()
		const first = create({ text: alias, categoryId })
		const direct = create({ text: owner.term })
		const repeat = create({ text: alias })

		expect([first.merged, direct.merged, repeat]).toMatchObject([
			false,
			false,
			{ merged: true, note: { id: first.note.id, text: alias } },
		])
		const captures = storedNotes()
		expect(captures).toMatchObject([
			{ id: first.note.id },
			{ id: direct.note.id, termId: owner.id },
		])
		expect(db.select().from(terms).orderBy(terms.id).all()).toMatchObject([
			{ id: owner.id, categoryId: null },
			{ id: captures[0]?.termId, term: alias, meaning: '', categoryId },
		])
	})

	it('picks the only sense matching the supplied category', async () => {
		const { id: categoryId } = await categoryRowFactory.transient({ db }).create()
		const senses = termRowFactory.transient({ db }).params({ term: 'cache' })
		const chosen = await senses.create({ meaning: 'a hidden supply', categoryId })
		await senses.create({ meaning: 'stored results' })

		expect(create({ text: 'Cache', categoryId }).merged).toBe(false)
		expect(storedNotes()).toMatchObject([{ termId: chosen.id, categoryId }])
	})

	it.each([
		['several senses in the category', true, false],
		['an existing unknown sense', true, true],
		['no capture category', false, false],
	])('uses the typed empty-meaning row with %s', async (_case, filed, existing) => {
		const { id } = await categoryRowFactory.transient({ db }).create()
		const categoryId = filed ? id : null
		const senses = termRowFactory.transient({ db }).params({ term: 'query' })
		await senses.create({ meaning: 'request', categoryId: id })
		await senses.create({ meaning: 'question', categoryId })
		const unknown = existing ? await senses.create({ term: 'queries', categoryId }) : undefined
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
	})

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

	it.each([
		['a duplicate paragraph', 'Paula recommended it', false],
		['empty', '', false],
		['null', null, false],
		['a substring of a paragraph', 'Paul', true],
	])('keeps populated fields when the new context is %s', async (_case, context, append) => {
		const [{ id: categoryId }, { id: otherCategory }] = await categoryRowFactory
			.transient({ db })
			.createList(2)

		const original = `${faker.lorem.sentence()}\n\nPaula recommended it`
		const first = create({ categoryId, context: original })

		const second = create({
			text: first.note.text,
			context,
			url: null,
			categoryId: otherCategory,
		})

		expect(second).toMatchObject({
			merged: true,
			note: {
				id: first.note.id,
				context: append ? `${original}\n\n${context}` : original,
				url: first.note.url,
				categoryId,
			},
		})
		expect(db.select().from(terms).all()).toMatchObject([{ categoryId }])
	})

	it.each([true, false])(
		'keeps a different URL in the paragraph (has context: %s)',
		(withContext) => {
			const first = create()
			const context = withContext ? faker.lorem.sentence() : null
			const url = faker.internet.url()
			const capture = { text: first.note.text, context, url }
			const paragraph = context === null ? url : `${context}\n${url}`

			const expected = {
				merged: true,
				note: { url: first.note.url, context: `${first.note.context}\n\n${paragraph}` },
			}

			expect([create(capture), create(capture)]).toMatchObject([expected, expected])
		},
	)

	it.each([4000, 4001])('counts the URL toward %i characters and continues merging', (length) => {
		const context = faker.lorem.sentence()
		const url = faker.internet.url()
		const paragraph = `${context}\n${url}`
		const original = faker.string.alpha(length - paragraph.length - 2)

		const {
			note: { text },
		} = create({ context: original })

		const second = create({ text, context, url })
		const fits = length === 4000
		const followUp = fits ? null : `${paragraph} ${faker.word.noun()}`
		const third = create({ text, context: followUp, url: null })

		expect(second.merged).toBe(fits)
		expect(third).toMatchObject({ merged: true, note: { id: second.note.id } })
		expect(storedNotes().map((note) => note.context)).toEqual(
			fits ? [`${original}\n\n${paragraph}`] : [original, `${context}\n\n${followUp}`],
		)
	})

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
