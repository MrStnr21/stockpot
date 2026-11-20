// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { $, nanoseconds } from 'bun'
import type { Database } from 'bun:sqlite'
import { afterAll, beforeAll, describe, expect, it, mock, spyOn, type Mock } from 'bun:test'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { categoryRowFactory } from '#tests/factories/categories'
import { noteRowFactory } from '#tests/factories/notes'
import { configuredSettingsFactory } from '#tests/factories/settings'
import { migrationsFolder } from '#tests/setup/db'
import type * as v from 'valibot'

import { openDatabase, type Db } from '#/server/db/client'
import { parseOutput, type SuggestInput } from '#/server/engines/contract'

import { createSuggester, type Suggester, type SuggestRequest } from './suggest'

const suggestionCount = 200

describe('category suggestions on a database file', () => {
	const folder = join(tmpdir(), `stockpot-suggest-budget-${crypto.randomUUID()}`)
	let sqlite: Database
	let db: Db
	let suggester: Suggester
	let requests: SuggestRequest[]
	let categoryId: number

	const router = {
		async suggest<TSchema extends v.GenericSchema>(input: SuggestInput<TSchema>) {
			const output = parseOutput(input.output, {
				categories: [String(categoryId)],
				senses: [],
				language: 'en',
			})

			return { output, engine: 'fake', model: null, searchSuggestions: null, elapsedMs: 0 }
		},
	}

	let calls: Mock<typeof router.suggest>

	beforeAll(async () => {
		await $`mkdir -p ${folder}`.quiet()
		;({ sqlite, db } = await openDatabase({ path: join(folder, 'stockpot.db'), migrationsFolder }))
		const category = await categoryRowFactory.transient({ db }).create()
		categoryId = category.id
		const { cardLanguage } = configuredSettingsFactory.build()
		suggester = createSuggester({ router })
		requests = noteRowFactory.buildList(suggestionCount).map(({ text, context }, index) => ({
			note: { text, context: context ?? null, url: null, isPrivate: false },
			history: index % 2 === 0 ? [{ categoryId, meaning: '' }] : [],
			language: cardLanguage,
		}))
		const uncached = requests.filter(({ history }) => history.length === 0)
		await Promise.all(uncached.map(async (request) => suggester.suggest(db, request)))
		calls = spyOn(router, 'suggest')
	})

	afterAll(async () => {
		mock.restore()
		sqlite.close()
		await $`rm -rf ${folder}`.quiet()
	})

	it('answers 100 history hits and 100 cache hits with a p95 under 50 ms', async () => {
		const times: number[] = []

		for (const request of requests) {
			const start = nanoseconds()
			// oxlint-disable-next-line no-await-in-loop -- Each latency measures a single request.
			const answer = await suggester.suggest(db, request)
			times.push((nanoseconds() - start) / 1e6)
			expect(answer.source).toBe(request.history.length === 0 ? 'engine' : 'history')
		}

		expect(calls).not.toHaveBeenCalled()

		const p95 =
			times.toSorted((a, b) => a - b)[Math.ceil(0.95 * suggestionCount) - 1] ??
			Number.POSITIVE_INFINITY

		expect(p95).toBeLessThan(50)
	})
})
