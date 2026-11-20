// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { beforeEach, describe, expect, it } from 'bun:test'
import { faker } from '@faker-js/faker'
import { categoryRowFactory } from '#tests/factories/categories'
import { cardInputFactory, privateNoteFactory } from '#tests/factories/engine-input'
import { explanationRowFactory } from '#tests/factories/explanations'
import { noteRowFactory } from '#tests/factories/notes'
import { termRowFactory } from '#tests/factories/terms'
import { createTestDb, type TestDb } from '#tests/setup/db'
import * as v from 'valibot'

import { explanations } from '#/server/db/schema/explanations'
import { notes, terms } from '#/server/db/schema/notes'
import { redactPrivate } from '#/server/engines/contract'
import { buildPrompt } from '#/server/engines/prompt'
import { HttpError } from '#/server/http'

import {
	cardCategory,
	changeCategory,
	createCategory,
	deleteCategory,
	listCategories,
	newCategorySchema,
	reorderCategories,
} from './server'

const category = categoryRowFactory.params({ color: 'tech', icon: 'globe' })

function errorOf(action: (() => ReturnType<typeof createCategory>) | (() => void)) {
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

describe('categories', () => {
	let db: TestDb

	beforeEach(async () => {
		;({ db } = await createTestDb())
	})

	function create(fields: Parameters<typeof category.build>[0] = {}) {
		return createCategory(db, v.parse(newCategorySchema, category.build(fields)))
	}

	function remove(id: number, moveTo?: number) {
		db.transaction((tx) => {
			deleteCategory(tx, id, moveTo)
		})
	}

	it('appends after the highest position and lists active note counts in position order', async () => {
		const later = await category.transient({ db }).create({ position: 18 })
		const earlier = await category.transient({ db }).create({ position: 17 })
		const last = create()
		const captures = noteRowFactory.transient({ db })
		await captures.createList(2, { categoryId: earlier.id })
		await captures.create({ categoryId: later.id, deletedAt: faker.date.recent() })
		await captures.create()

		expect(listCategories(db).slice(-3)).toMatchObject([
			{ id: earlier.id, position: 17, noteCount: 2 },
			{ id: later.id, position: 18, noteCount: 0 },
			{ id: last.id, position: 19, noteCount: 0 },
		])
	})

	it('starts positions at zero after all categories have been deleted', () => {
		for (const { id } of listCategories(db)) {
			remove(id)
		}

		expect(create().position).toBe(0)
	})

	it('refuses duplicate names on create and edit, including non-ASCII case differences', () => {
		const original = create({ name: `É${faker.word.noun()}`.toLowerCase() })
		const name = original.name.toUpperCase()
		const other = create()
		const conflict = { status: 409, code: 'category_exists' }

		expect(errorOf(() => create({ name }))).toMatchObject(conflict)
		expect(errorOf(() => changeCategory(db, other.id, { name }))).toMatchObject(conflict)
		expect(changeCategory(db, original.id, { name }).name).toBe(name)
	})

	it('edits the category fields and preserves the format of existing cards', async () => {
		const original = create({ format: 'technology' })
		const note = await noteRowFactory.transient({ db }).create({ categoryId: original.id })

		const card = await explanationRowFactory
			.transient({ db })
			.create({ noteId: note.id, format: original.format })

		const change = {
			name: category.build().name,
			color: 'ai',
			icon: 'heart',
			format: 'report',
			instructions: faker.lorem.paragraph(),
		} as const

		expect(changeCategory(db, original.id, change)).toMatchObject({
			...change,
			position: original.position,
		})
		expect(db.select().from(explanations).all()).toEqual([card])
	})

	it('rewrites positions to match the complete order', () => {
		const ids = listCategories(db)
			.map(({ id }) => id)
			.toReversed()

		reorderCategories(db, ids)

		expect(listCategories(db)).toMatchObject(ids.map((id, position) => ({ id, position })))
	})

	it('rejects missing, extra, repeated and unknown ids while preserving the order', () => {
		const before = listCategories(db)
		const ids = before.map(({ id }) => id).toReversed()
		const unknown = Number.MAX_SAFE_INTEGER

		function reorder(idsToPlace: number[]) {
			reorderCategories(db, idsToPlace)
		}

		for (const invalid of [
			ids.slice(1),
			[...ids, unknown],
			[...ids.slice(1), ...ids.slice(-1)],
			[...ids.slice(1), unknown],
		]) {
			expect(
				errorOf(() => {
					reorder(invalid)
				}),
			).toMatchObject({ status: 400 })
			expect(listCategories(db)).toEqual(before)
		}
	})

	it('answers 404 for an unknown category on edit and delete', () => {
		const missing = Number.MAX_SAFE_INTEGER
		expect(errorOf(() => changeCategory(db, missing, { color: 'concept' }))).toMatchObject({
			status: 404,
		})
		expect(
			errorOf(() => {
				remove(missing)
			}),
		).toMatchObject({ status: 404 })
	})

	it('asks for a target with the count of notes that are not deleted', async () => {
		const { id } = create()
		const captures = noteRowFactory.transient({ db })

		await captures.create({ categoryId: id, deletedAt: faker.date.recent() })
		await captures.createList(2, { categoryId: id })
		expect(
			errorOf(() => {
				remove(id)
			}),
		).toMatchObject({ status: 409, code: 'category_in_use', notes: 2 })
	})

	it('deletes at once when only soft-deleted notes have the category', async () => {
		const { id } = create()
		const captures = noteRowFactory.transient({ db })
		const deleted = await captures.create({ categoryId: id, deletedAt: faker.date.recent() })

		remove(id)

		expect(listCategories(db).map((row) => row.id)).not.toContain(id)
		expect(db.select().from(notes).all()).toMatchObject([{ id: deleted.id, categoryId: null }])
	})

	it('requires a different existing move target even for an empty category', () => {
		const { id } = create()
		const before = listCategories(db)

		for (const invalid of [id, Number.MAX_SAFE_INTEGER]) {
			expect(
				errorOf(() => {
					remove(id, invalid)
				}),
			).toMatchObject({ status: 400 })
		}

		expect(listCategories(db)).toEqual(before)
	})

	it('moves all filed notes and terms to the target before deleting the category', async () => {
		const source = create()
		const target = create()
		const captures = noteRowFactory.transient({ db })
		const active = await captures.create({ categoryId: source.id })
		const deleted = await captures.create({ categoryId: source.id, deletedAt: faker.date.recent() })
		const unfiled = await captures.create()
		const filedTerm = await termRowFactory.transient({ db }).create({ categoryId: source.id })
		const otherTerm = await termRowFactory.transient({ db }).create()

		remove(source.id, target.id)

		expect(listCategories(db).map(({ id }) => id)).not.toContain(source.id)
		expect(db.select().from(notes).orderBy(notes.id).all()).toMatchObject([
			{ id: active.id, categoryId: target.id },
			{ id: deleted.id, categoryId: target.id, deletedAt: deleted.deletedAt },
			unfiled,
		])
		expect(db.select().from(terms).orderBy(terms.id).all()).toMatchObject([
			{ id: filedTerm.id, categoryId: target.id },
			otherTerm,
		])
	})

	it('deletes immediately and unfiles terms when no notes need moving', async () => {
		const { id } = create()
		const term = await termRowFactory.transient({ db }).create({ categoryId: id })

		remove(id)

		expect(listCategories(db).map((row) => row.id)).not.toContain(id)
		expect(db.select().from(terms).all()).toMatchObject([{ id: term.id, categoryId: null }])
	})

	it('includes stored category instructions in the rendered prompt for a private note', () => {
		const instructions = faker.lorem.paragraph()
		const stored = create({ instructions, format: 'technology' })

		const input = cardInputFactory.build({
			note: privateNoteFactory.build(),
			category: cardCategory(stored),
		})

		expect(buildPrompt(redactPrivate(input), { canSearch: false })).toContain(
			`# Category\n${stored.name}\n\n${instructions}`,
		)
	})

	it('provides null instructions for a stored category with only whitespace', async () => {
		const stored = await category.transient({ db }).create({ instructions: ' \n\t' })

		expect(cardCategory(stored)).toEqual({ name: stored.name, instructions: null })
	})
})
