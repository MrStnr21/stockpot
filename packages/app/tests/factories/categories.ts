// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { faker } from '@faker-js/faker'
import type { DbTransientParams } from '#tests/factories/db'
import { Factory } from 'fishery'

import type { CategoryRow } from '#/features/settings/shared/types'
import { categoryColors, categoryIcons } from '#/lib/category-look'
import { formatIds } from '#/lib/format-ids'
import { categories } from '#/server/db/schema/notes'

/** Categories with a card format; `create()` inserts the row into the spec's database. */
export const categoryRowFactory = Factory.define<
	typeof categories.$inferInsert,
	DbTransientParams,
	typeof categories.$inferSelect
>(({ onCreate, sequence, transientParams }) => {
	onCreate((category) => {
		if (transientParams.db === undefined) {
			throw new Error('Pass the database: categoryRowFactory.transient({ db }).create()')
		}

		return transientParams.db.insert(categories).values(category).returning().get()
	})

	// Names are unique, so the sequence keeps two random nouns from colliding.
	return {
		name: `${faker.word.noun()} ${sequence}`,
		format: faker.helpers.arrayElement(formatIds),
	}
})

/** A category as `GET /api/categories` lists it, with its note count. */
export const listedCategoryFactory = Factory.define<CategoryRow>(({ sequence }) => ({
	id: sequence,
	name: `${faker.word.noun()} ${sequence}`,
	icon: faker.helpers.arrayElement(categoryIcons),
	color: faker.helpers.arrayElement(categoryColors),
	format: faker.helpers.arrayElement(formatIds),
	instructions: '',
	position: sequence,
	noteCount: faker.number.int({ min: 0, max: 40 }),
}))
