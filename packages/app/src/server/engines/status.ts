// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

/*
 * Each engine's state for the settings page, from its configuration and its latest `engine_runs`
 * row: the row of a test call and of real work alike. Two queries per engine, both on
 * `engine_runs_engine_started_at_idx`.
 */
import { and, count, desc, eq, gte } from 'drizzle-orm'

import type { Db } from '#/server/db/client'
import { engineRuns, type engineOutcomes } from '#/server/db/schema/jobs'

import type { Task } from './contract'
import { configuredEngines, engineIds, type EngineId, type EngineSettings } from './settings'

type RunOutcome = (typeof engineOutcomes)[number]

export type EngineState =
	'not_set_up' | 'untested' | 'working' | 'limited' | 'key_rejected' | 'failing'

export interface EngineOverview {
	readonly id: EngineId
	readonly configured: boolean
	readonly state: EngineState
	/** When the latest call started, as an ISO timestamp. */
	readonly lastCallAt: string | null
	readonly lastOutcome: RunOutcome | null
	/** Calls that succeeded since local midnight in the digest time zone; a test call is a suggestion. */
	readonly today: { readonly suggestions: number; readonly cards: number }
}

export interface EngineOverviewOptions {
	readonly engines: EngineSettings
	readonly agentCommand: string | null
	/** The digest time zone, where "today" starts. */
	readonly timeZone: string
	readonly now: Date
}

const stateOfOutcome = {
	ok: 'working',
	auth: 'key_rejected',
	// The row has no reset time, so the page says only that the engine is limited.
	rate_limited: 'limited',
	timeout: 'failing',
	invalid: 'failing',
	error: 'failing',
} as const satisfies Record<RunOutcome, EngineState>

/** The engine's latest call; exported so a spec can assert that it reads the index. */
// oxlint-disable-next-line typescript/explicit-module-boundary-types -- The Drizzle query type is long; readEngineOverview runs it.
export function latestRunQuery(db: Db, id: EngineId) {
	return db
		.select({ startedAt: engineRuns.startedAt, outcome: engineRuns.outcome })
		.from(engineRuns)
		.where(eq(engineRuns.engine, id))
		.orderBy(desc(engineRuns.startedAt))
		.limit(1)
}

/** The engine's successful calls per task since `since`; exported like `latestRunQuery`. */
// oxlint-disable-next-line typescript/explicit-module-boundary-types -- The Drizzle query type is long; readEngineOverview runs it.
export function successCountsQuery(db: Db, id: EngineId, since: Date) {
	return db
		.select({ task: engineRuns.task, calls: count() })
		.from(engineRuns)
		.where(
			and(
				eq(engineRuns.engine, id),
				gte(engineRuns.startedAt, since),
				eq(engineRuns.outcome, 'ok'),
			),
		)
		.groupBy(engineRuns.task)
}

function startOfDay(now: Date, timeZone: string): Date {
	const midnight = Temporal.Instant.fromEpochMilliseconds(now.getTime())
		.toZonedDateTimeISO(timeZone)
		.startOfDay()

	return new Date(midnight.epochMilliseconds)
}

function stateOf(isConfigured: boolean, latest: RunOutcome | undefined): EngineState {
	if (!isConfigured) {
		return 'not_set_up'
	}

	return latest === undefined ? 'untested' : stateOfOutcome[latest]
}

/** Every engine, in `engineIds` order. */
export function readEngineOverview(
	db: Db,
	{ engines, agentCommand, timeZone, now }: EngineOverviewOptions,
): EngineOverview[] {
	const configured = new Set(configuredEngines(engines, agentCommand))
	const since = startOfDay(now, timeZone)

	return engineIds.map((id) => {
		const latest = latestRunQuery(db, id).get()
		const counts = successCountsQuery(db, id, since).all()

		function callsOf(...tasks: Task[]) {
			return counts
				.filter(({ task }) => tasks.includes(task))
				.reduce((sum, { calls }) => sum + calls, 0)
		}

		return {
			id,
			configured: configured.has(id),
			state: stateOf(configured.has(id), latest?.outcome),
			lastCallAt: latest?.startedAt.toISOString() ?? null,
			lastOutcome: latest?.outcome ?? null,
			today: { suggestions: callsOf('suggest'), cards: callsOf('explain', 'research') },
		}
	})
}

/** Whether an engine needs the owner: its key was rejected or its calls fail. */
export function needsAttention(overview: readonly EngineOverview[]): boolean {
	return overview.some(({ state }) => state === 'key_rejected' || state === 'failing')
}
