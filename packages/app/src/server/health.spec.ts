// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { beforeEach, describe, expect, it } from 'bun:test'
import { engineRunRowFactory } from '#tests/factories/jobs'
import { createTestDb, type TestDb } from '#tests/setup/db'
import * as v from 'valibot'

import type { EngineId } from '#/server/engines/settings'
import type { RunnerHealth } from '#/server/jobs/types'

import { healthResponse, type HealthSources } from './health'

const healthy: RunnerHealth = { status: 'healthy' }

const statusWord = v.picklist(['ok', 'failing', 'not configured'])

// Strict objects: a key beyond these, such as an error or a path, fails the parse.
const statusWordsOnly = v.strictObject({
	database: statusWord,
	runner: statusWord,
	engines: v.strictObject({
		'agent-command': statusWord,
		gemini: statusWord,
		'openai-compatible': statusWord,
	}),
})

function sourcesFor(db: TestDb, configured: readonly EngineId[] = []): HealthSources {
	return { db: async () => db, runner: () => healthy, configuredEngines: () => configured }
}

describe('healthResponse', () => {
	describe('without the database', () => {
		let response: Response

		beforeEach(async () => {
			const { sqlite, db } = await createTestDb()

			sqlite.close()
			response = await healthResponse(sourcesFor(db, ['gemini']))
		})

		it('answers 503 with the database failing', async () => {
			expect([response.status, await response.json()]).toEqual([
				503,
				{
					database: 'failing',
					runner: 'ok',
					engines: {
						'agent-command': 'failing',
						gemini: 'failing',
						'openai-compatible': 'failing',
					},
				},
			])
		})
	})

	describe('when the database cannot be opened', () => {
		it('answers 503', async () => {
			const response = await healthResponse({
				db: async () => {
					throw new Error('SQLITE_CANTOPEN: /var/lib/stockpot/stockpot.db')
				},
				runner: () => healthy,
				configuredEngines: () => [],
			})

			expect(response.status).toBe(503)
			expect(await response.text()).not.toContain('stockpot.db')
		})
	})

	describe('with a working database', () => {
		let db: TestDb
		let response: Response

		beforeEach(async () => {
			;({ db } = await createTestDb())

			const factory = engineRunRowFactory.transient({ db })

			await factory.create({ engine: 'gemini', outcome: 'auth', startedAt: new Date(1000) })
			await factory.create({ engine: 'gemini', outcome: 'ok', startedAt: new Date(2000) })
			await factory.create({
				engine: 'openai-compatible',
				outcome: 'ok',
				startedAt: new Date(1000),
			})
			await factory.create({
				engine: 'openai-compatible',
				outcome: 'auth',
				startedAt: new Date(2000),
			})

			response = await healthResponse(sourcesFor(db, ['gemini', 'openai-compatible']))
		})

		it('answers 200 with each part, judging an engine by its latest run', async () => {
			expect([response.status, await response.json()]).toEqual([
				200,
				{
					database: 'ok',
					runner: 'ok',
					engines: {
						'agent-command': 'not configured',
						gemini: 'ok',
						'openai-compatible': 'failing',
					},
				},
			])
		})

		it('holds status words only', async () => {
			const parsed = v.safeParse(statusWordsOnly, await response.json())

			expect(parsed.issues).toBeUndefined()
		})

		it('is never cached', () => {
			expect(response.headers.get('cache-control')).toBe('no-store')
		})
	})

	describe('with the runner', () => {
		let db: TestDb

		beforeEach(async () => {
			;({ db } = await createTestDb())
		})

		it.each<[string, RunnerHealth | undefined]>([
			['not started', undefined],
			['failing', { status: 'failing', lastError: 'disk I/O error', failedAt: new Date() }],
		])('reports it failing when it is %s, still with 200', async (_state, health) => {
			const response = await healthResponse({ ...sourcesFor(db), runner: () => health })

			expect([response.status, await response.json()]).toMatchObject([200, { runner: 'failing' }])
		})
	})

	describe('with settings that no longer validate', () => {
		it('reports every engine failing', async () => {
			const { db } = await createTestDb()

			const response = await healthResponse({
				...sourcesFor(db),
				configuredEngines: () => {
					throw new Error('engines.gemini.apiKey: Invalid type')
				},
			})

			expect(await response.json()).toMatchObject({
				database: 'ok',
				engines: { 'agent-command': 'failing', gemini: 'failing', 'openai-compatible': 'failing' },
			})
		})
	})
})
