// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { faker } from '@faker-js/faker'
import type { DbTransientParams } from '#tests/factories/db'
import { Factory } from 'fishery'

import { engineRuns, jobs } from '#/server/db/schema/jobs'

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

/** Rows of the engine_runs table, for the runs an engine finds when the server starts. */
export const engineRunRowFactory = Factory.define<
	typeof engineRuns.$inferInsert,
	DbTransientParams,
	typeof engineRuns.$inferSelect
>(({ onCreate, transientParams }) => {
	onCreate((run) => {
		if (transientParams.db === undefined) {
			throw new Error('Pass the database: engineRunRowFactory.transient({ db }).create()')
		}

		return transientParams.db.insert(engineRuns).values(run).returning().get()
	})

	return {
		engine: 'gemini',
		model: 'gemini-3.1-flash-lite',
		task: 'suggest',
		outcome: 'ok',
		startedAt: new Date(),
		durationMs: faker.number.int({ min: 300, max: 3000 }),
	}
})
