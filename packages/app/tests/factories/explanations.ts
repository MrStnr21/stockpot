// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { faker } from '@faker-js/faker'
import type { DbTransientParams } from '#tests/factories/db'
import { Factory } from 'fishery'

import { explanations } from '#/server/db/schema/explanations'

/** Cards in a made-up format; pass the `noteId` they belong to, and the database to `create()` them. */
export const explanationRowFactory = Factory.define<
	typeof explanations.$inferInsert,
	DbTransientParams,
	typeof explanations.$inferSelect
>(({ onCreate, transientParams }) => {
	onCreate((card) => {
		if (transientParams.db === undefined) {
			throw new Error('Pass the database: explanationRowFactory.transient({ db }).create()')
		}

		return transientParams.db.insert(explanations).values(card).returning().get()
	})

	return {
		format: 'technology',
		language: 'en',
		body: { summary: faker.lorem.sentence(), analogy: faker.lorem.sentence() },
		engine: 'agent-cli',
		promptVersion: 'v1',
	}
})
