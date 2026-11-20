// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { faker } from '@faker-js/faker'
import type { DbTransientParams } from '#tests/factories/db'
import { Factory } from 'fishery'

import { aliases, terms } from '#/server/db/schema/notes'

/** Normalized terms; `create()` inserts the row into the spec's database. */
export const termRowFactory = Factory.define<
	typeof terms.$inferInsert,
	DbTransientParams,
	typeof terms.$inferSelect
>(({ onCreate, transientParams }) => {
	onCreate((term) => {
		if (transientParams.db === undefined) {
			throw new Error('Pass the database: termRowFactory.transient({ db }).create()')
		}

		return transientParams.db.insert(terms).values(term).returning().get()
	})

	return { term: faker.word.noun().toLowerCase() }
})

/** Pass the owning term's id and the database to persist a learned alias. */
export const aliasRowFactory = Factory.define<
	typeof aliases.$inferInsert,
	DbTransientParams,
	typeof aliases.$inferSelect
>(({ onCreate, sequence, transientParams }) => {
	onCreate((alias) => {
		if (transientParams.db === undefined) {
			throw new Error('Pass the database: aliasRowFactory.transient({ db }).create()')
		}

		return transientParams.db.insert(aliases).values(alias).returning().get()
	})

	return { alias: `${faker.word.adjective()} ${sequence}`, termId: sequence }
})
