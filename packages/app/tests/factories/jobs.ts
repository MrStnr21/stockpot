// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { faker } from '@faker-js/faker'
import type { DbTransientParams } from '#tests/factories/db'
import { Factory } from 'fishery'

import { jobs } from '#/server/db/schema/jobs'

/** Rows of the jobs table, for states the runner leaves behind, such as a job a crash left running. */
export const jobRowFactory = Factory.define<
	typeof jobs.$inferInsert,
	DbTransientParams,
	typeof jobs.$inferSelect
>(({ onCreate, transientParams }) => {
	onCreate((job) => {
		if (transientParams.db === undefined) {
			throw new Error('Pass the database: jobRowFactory.transient({ db }).create()')
		}

		return transientParams.db.insert(jobs).values(job).returning().get()
	})

	return {
		kind: faker.word.verb(),
		payload: {},
	}
})
