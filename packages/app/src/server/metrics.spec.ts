// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { beforeEach, describe, expect, it } from 'bun:test'
import { faker } from '@faker-js/faker'
import { engineRunRowFactory, jobRowFactory } from '#tests/factories/jobs'
import { createTestDb, type TestDb } from '#tests/setup/db'

import { metricsContentType, metricsResponse, renderMetrics } from './metrics'

const token = faker.string.alphanumeric(48)

function scrape(authorization?: string) {
	const headers = authorization === undefined ? undefined : { authorization }

	return new Request('https://stockpot.example.ts.net/metrics', { headers })
}

describe('metrics', () => {
	let db: TestDb

	beforeEach(async () => {
		;({ db } = await createTestDb())
	})

	describe('renderMetrics', () => {
		let lines: string[]

		beforeEach(async () => {
			const jobs = jobRowFactory.transient({ db })
			const runs = engineRunRowFactory.transient({ db })

			await jobs.createList(2, { kind: 'research', status: 'done', attempts: 1 })
			await jobs.create({ kind: 'research', status: 'failed', attempts: 5 })
			await jobs.create({ kind: 'digest', status: 'queued' })
			await runs.create({ engine: 'gemini', outcome: 'ok', durationMs: 1200 })
			await runs.create({ engine: 'gemini', outcome: 'ok', durationMs: 800 })
			await runs.create({ engine: 'gemini', outcome: 'rate_limited', durationMs: 300 })

			lines = renderMetrics(db).split('\n')
		})

		it('counts jobs by kind and status', () => {
			expect(lines).toContainValues([
				'# TYPE stockpot_jobs gauge',
				'stockpot_jobs{kind="digest",status="queued"} 1',
				'stockpot_jobs{kind="research",status="done"} 2',
				'stockpot_jobs{kind="research",status="failed"} 1',
			])
		})

		it('sums their attempts', () => {
			expect(lines).toContainValues([
				'stockpot_job_attempts{kind="digest",status="queued"} 0',
				'stockpot_job_attempts{kind="research",status="done"} 2',
				'stockpot_job_attempts{kind="research",status="failed"} 5',
			])
		})

		it('counts engine runs and their durations by engine and outcome', () => {
			expect(lines).toContainValues([
				'# TYPE stockpot_engine_run_duration_seconds summary',
				'stockpot_engine_run_duration_seconds_sum{engine="gemini",outcome="ok"} 2',
				'stockpot_engine_run_duration_seconds_count{engine="gemini",outcome="ok"} 2',
				'stockpot_engine_run_duration_seconds_sum{engine="gemini",outcome="rate_limited"} 0.3',
				'stockpot_engine_run_duration_seconds_count{engine="gemini",outcome="rate_limited"} 1',
			])
		})

		it('ends with a line feed', () => {
			expect(lines.at(-1)).toBe('')
		})

		it('escapes backslashes, quotes and line feeds in labels', async () => {
			await jobRowFactory.transient({ db }).create({ kind: 'a\\b"c\nd' })

			expect(renderMetrics(db)).toContain(
				String.raw`stockpot_jobs{kind="a\\b\"c\nd",status="queued"} 1`,
			)
		})
	})

	describe('metricsResponse', () => {
		describe('without STOCKPOT_METRICS_TOKEN', () => {
			it('answers 404, as if the route did not exist', async () => {
				const response = await metricsResponse(scrape(`Bearer ${token}`), {
					token: null,
					db: async () => db,
				})

				expect(response.status).toBe(404)
			})
		})

		describe('with STOCKPOT_METRICS_TOKEN', () => {
			it.each([
				['no Authorization header', undefined],
				['a wrong token', `Bearer ${faker.string.alphanumeric(48)}`],
				['the token with another scheme', `Basic ${token}`],
				['a prefix of the token', `Bearer ${token.slice(0, -1)}`],
			])('answers 401 to %s', async (_case, authorization) => {
				const response = await metricsResponse(scrape(authorization), {
					token,
					db: async () => db,
				})

				expect([response.status, response.headers.get('www-authenticate')]).toEqual([401, 'Bearer'])
			})

			it('answers 200 with the metrics to the right token', async () => {
				await jobRowFactory.transient({ db }).create({ kind: 'research' })

				const response = await metricsResponse(scrape(`Bearer ${token}`), {
					token,
					db: async () => db,
				})

				expect([response.status, response.headers.get('content-type')]).toEqual([
					200,
					metricsContentType,
				])
				expect(await response.text()).toContain('stockpot_jobs{kind="research",status="queued"} 1')
			})
		})
	})
})
