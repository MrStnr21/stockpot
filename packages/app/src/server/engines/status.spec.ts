// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { beforeEach, describe, expect, it } from 'bun:test'
import { engineRunRowFactory } from '#tests/factories/jobs'
import { agentCommand, configuredSettingsFactory } from '#tests/factories/settings'
import { createTestDb, type TestDb } from '#tests/setup/db'
import { sql } from 'drizzle-orm'

import type { engineOutcomes } from '#/server/db/schema/jobs'

import { defaultEngines } from './settings'
import {
	latestRunQuery,
	needsAttention,
	readEngineOverview,
	successCountsQuery,
	type EngineOverview,
	type EngineState,
} from './status'

// 11:00 in Berlin, where the day began at 23:00 UTC the evening before.
const now = new Date('2026-11-20T10:00:00.000Z')

const timeZone = 'Europe/Berlin'

const { engines: configured } = configuredSettingsFactory.build()

function gemini(overview: readonly EngineOverview[]) {
	return overview.find(({ id }) => id === 'gemini')
}

describe('engine overview', () => {
	let db: TestDb

	beforeEach(async () => {
		;({ db } = await createTestDb())
	})

	function overviewOf(engines = configured, command: string | null = agentCommand()) {
		return readEngineOverview(db, { engines, agentCommand: command, timeZone, now })
	}

	async function runAt(
		iso: string,
		fields: Partial<Parameters<typeof engineRunRowFactory.build>[0]> = {},
	) {
		return engineRunRowFactory
			.transient({ db })
			.create({ engine: 'gemini', startedAt: new Date(iso), ...fields })
	}

	it('lists every engine in order, untested while it has no call', () => {
		expect(overviewOf().map(({ id, state }) => [id, state])).toEqual([
			['agent-command', 'untested'],
			['gemini', 'untested'],
			['openai-compatible', 'untested'],
		])
	})

	it.each([
		['ok', 'working'],
		['auth', 'key_rejected'],
		['rate_limited', 'limited'],
		['timeout', 'failing'],
		['invalid', 'failing'],
		['error', 'failing'],
	] satisfies [(typeof engineOutcomes)[number], EngineState][])(
		'takes the state of a latest %s call as %s',
		async (outcome, state) => {
			await runAt('2026-11-19T08:00:00.000Z', { outcome: outcome === 'ok' ? 'error' : 'ok' })
			await runAt('2026-11-20T09:00:00.000Z', { outcome })

			expect(gemini(overviewOf())).toMatchObject({
				configured: true,
				state,
				lastCallAt: '2026-11-20T09:00:00.000Z',
				lastOutcome: outcome,
			})
		},
	)

	it('answers not_set_up for an engine that is not configured, whatever its calls', async () => {
		await runAt('2026-11-20T09:00:00.000Z', { outcome: 'ok' })

		expect(overviewOf(defaultEngines(), null).map(({ state }) => state)).toEqual([
			'not_set_up',
			'not_set_up',
			'not_set_up',
		])
	})

	it('counts the calls that succeeded since local midnight, by kind', async () => {
		// 23:30 in Berlin the day before.
		await runAt('2026-11-19T22:30:00.000Z', { task: 'suggest' })
		// 00:30 in Berlin.
		await runAt('2026-11-19T23:30:00.000Z', { task: 'suggest' })
		await runAt('2026-11-20T08:00:00.000Z', { task: 'suggest' })
		await runAt('2026-11-20T08:10:00.000Z', { task: 'explain' })
		await runAt('2026-11-20T08:20:00.000Z', { task: 'research' })
		await runAt('2026-11-20T08:30:00.000Z', { task: 'explain', outcome: 'timeout' })
		await runAt('2026-11-20T08:40:00.000Z', { task: 'suggest', engine: 'openai-compatible' })

		expect(gemini(overviewOf())?.today).toEqual({ suggestions: 2, cards: 2 })
	})

	it.each([
		['the latest call', () => latestRunQuery(db, 'gemini')],
		['the counts', () => successCountsQuery(db, 'gemini', now)],
	])('reads %s through the engine and time index', (_name, query) => {
		const plan = db
			.all<{ detail: string }>(sql`EXPLAIN QUERY PLAN ${query().getSQL()}`)
			.map(({ detail }) => detail)
			.join('\n')

		expect(plan).toContain('engine_runs_engine_started_at_idx')
	})

	describe('needsAttention', () => {
		it.each([
			['key_rejected', true],
			['failing', true],
			['limited', false],
			['untested', false],
			['not_set_up', false],
			['working', false],
		] satisfies [EngineState, boolean][])('is %s → %s', (state, expected) => {
			const engine: EngineOverview = {
				id: 'gemini',
				configured: true,
				state,
				lastCallAt: null,
				lastOutcome: null,
				today: { suggestions: 0, cards: 0 },
			}

			expect(needsAttention([...overviewOf(), engine])).toBe(expected)
		})
	})
})
