// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { faker } from '@faker-js/faker'
import type { DbTransientParams } from '#tests/factories/db'
import { Factory } from 'fishery'

import { notes } from '#/server/db/schema/notes'

/** Notes as capture saves them; `create()` inserts the row into the spec's database. */
export const noteRowFactory = Factory.define<
	typeof notes.$inferInsert,
	DbTransientParams,
	typeof notes.$inferSelect
>(({ onCreate, transientParams }) => {
	onCreate((note) => {
		if (transientParams.db === undefined) {
			throw new Error('Pass the database: noteRowFactory.transient({ db }).create()')
		}

		return transientParams.db.insert(notes).values(note).returning().get()
	})

	return {
		text: faker.word.noun(),
		context: faker.lorem.sentence(),
	}
})
