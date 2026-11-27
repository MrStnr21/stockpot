// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { and, count, eq, getColumns, isNull, max } from 'drizzle-orm'

import type { Db } from '#/server/db/client'
import { categories, notes, terms } from '#/server/db/schema/notes'
import type { CardInput } from '#/server/engines/contract'
import { HttpError, type ErrorDetails } from '#/server/http'

import type { CategoryChange, NewCategory } from './schemas'

export {
	categoryChangeSchema,
	categoryIdSchema,
	categoryOrderSchema,
	newCategorySchema,
} from './schemas'

type Category = typeof categories.$inferSelect

type Transaction = Parameters<Parameters<Db['transaction']>[0]>[0]

/** The 409 for a category with notes, with their count for the "move them to" question. */
interface CategoryInUse extends ErrorDetails {
	readonly notes: number
}

export function listCategories(db: Db): (Category & { noteCount: number })[] {
	return db
		.select({ ...getColumns(categories), noteCount: count(notes.id) })
		.from(categories)
		.leftJoin(notes, and(eq(notes.categoryId, categories.id), isNull(notes.deletedAt)))
		.groupBy(categories.id)
		.orderBy(categories.position, categories.id)
		.all()
}

// SQLite's built-in NOCASE collation only folds ASCII letters.
const categoryNames = new Intl.Collator('en', { sensitivity: 'accent' })

function notFound() {
	return new HttpError(404, { code: 'not_found', message: 'There is no such category.' })
}

/** The category with this id; 404 when there is none. */
export function findCategory(db: Db, id: number): Category {
	const row = db.select().from(categories).where(eq(categories.id, id)).get()

	if (row === undefined) {
		throw notFound()
	}

	return row
}

function requireAvailableName(tx: Transaction, name: string, ownId?: number) {
	const rows = tx.select({ id: categories.id, name: categories.name }).from(categories).all()

	if (ownId !== undefined && !rows.some(({ id }) => id === ownId)) {
		throw notFound()
	}

	if (rows.some((row) => row.id !== ownId && categoryNames.compare(row.name, name) === 0)) {
		throw new HttpError(409, {
			code: 'category_exists',
			message: 'A category already has that name.',
		})
	}
}

function hasCategory(tx: Transaction, id: number) {
	return (
		tx.select({ id: categories.id }).from(categories).where(eq(categories.id, id)).get() !==
		undefined
	)
}

export function createCategory(db: Db, category: NewCategory): Category {
	return db.transaction(
		(tx) => {
			requireAvailableName(tx, category.name)

			const last = tx
				.select({ position: max(categories.position) })
				.from(categories)
				.get()

			const position = (last?.position ?? -1) + 1

			return tx
				.insert(categories)
				.values({ ...category, position })
				.returning()
				.get()
		},
		{ behavior: 'immediate' },
	)
}

export function changeCategory(db: Db, id: number, change: CategoryChange): Category {
	return db.transaction(
		(tx) => {
			if (change.name !== undefined) {
				requireAvailableName(tx, change.name, id)
			}

			const row = tx.update(categories).set(change).where(eq(categories.id, id)).returning().get()

			if (row === undefined) {
				throw notFound()
			}

			return row
		},
		{ behavior: 'immediate' },
	)
}

export function reorderCategories(db: Db, ids: readonly number[]): void {
	db.transaction(
		(tx) => {
			const rows = tx.select({ id: categories.id }).from(categories).all()
			const remaining = new Set(rows.map(({ id }) => id))

			if (ids.length !== remaining.size || !ids.every((id) => remaining.delete(id))) {
				throw new HttpError(400, {
					code: 'invalid_body',
					message: 'Include every category id exactly once.',
				})
			}

			for (const [position, id] of ids.entries()) {
				tx.update(categories).set({ position }).where(eq(categories.id, id)).run()
			}
		},
		{ behavior: 'immediate' },
	)
}

/** The caller owns the transaction so the routing override can be removed with the category. */
export function deleteCategory(tx: Transaction, id: number, moveTo?: number): void {
	if (!hasCategory(tx, id)) {
		throw notFound()
	}

	const filedNotes = eq(notes.categoryId, id)

	if (moveTo === undefined) {
		/* Only notes the owner can see need a target: the count matches the list's `noteCount`, and a
		 * soft-deleted note simply loses its category through the foreign key. */
		const total = tx
			.select({ notes: count() })
			.from(notes)
			.where(and(filedNotes, isNull(notes.deletedAt)))
			.get()

		if (total && total.notes > 0) {
			const details: CategoryInUse = {
				code: 'category_in_use',
				message: 'Choose a category to move these notes to.',
				notes: total.notes,
			}

			throw new HttpError(409, details)
		}
	} else {
		if (moveTo === id || !hasCategory(tx, moveTo)) {
			throw new HttpError(400, {
				code: 'invalid_query',
				message: 'Choose a different existing category.',
			})
		}

		tx.update(notes).set({ categoryId: moveTo }).where(filedNotes).run()
		tx.update(terms).set({ categoryId: moveTo }).where(eq(terms.categoryId, id)).run()
	}

	tx.delete(categories).where(eq(categories.id, id)).run()
}

export function cardCategory({
	name,
	instructions,
}: Pick<Category, 'name' | 'instructions'>): CardInput['category'] {
	const trimmed = instructions.trim()

	return { name, instructions: trimmed === '' ? null : trimmed }
}
