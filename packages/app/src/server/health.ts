// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

/*
 * The health check behind `/healthz`. The route is public (D6), so the body holds status words only:
 * no paths, versions, errors or settings. Engine login status comes from configuration and each
 * engine's latest recorded run; a health check never calls an engine.
 */
import { desc, eq, sql } from 'drizzle-orm'

import type { Db } from '#/server/db/client'
import { engineRuns } from '#/server/db/schema/jobs'
import type { EngineId } from '#/server/engines/settings'
import type { RunnerHealth } from '#/server/jobs/types'

export type PartStatus = 'ok' | 'failing'

export type EngineStatus = PartStatus | 'not configured'

export interface Health {
	readonly database: PartStatus
	readonly runner: PartStatus
	readonly engines: Readonly<Record<EngineId, EngineStatus>>
}

export interface HealthSources {
	/** The instance database; a rejection counts as a failing database. */
	readonly db: () => Promise<Db>
	/** The process runner's health, or `undefined` when no runner has started. */
	readonly runner: () => RunnerHealth | undefined
	/** The engines that can take a call, from settings and the environment. */
	readonly configuredEngines: (db: Db) => readonly EngineId[]
}

function allEngines(status: EngineStatus): Record<EngineId, EngineStatus> {
	return { 'agent-command': status, gemini: status, 'openai-compatible': status }
}

/** The database, if a read from it works: the read touches a table, not just the connection. */
async function workingDatabase(open: () => Promise<Db>) {
	try {
		const db = await open()

		db.get(sql`select id from jobs limit 1`)

		return db
	} catch {
		return null
	}
}

/** Served by `engine_runs_engine_started_at_idx`: one index seek per engine. */
function latestOutcome(db: Db, engine: EngineId) {
	return db
		.select({ outcome: engineRuns.outcome })
		.from(engineRuns)
		.where(eq(engineRuns.engine, engine))
		.orderBy(desc(engineRuns.startedAt))
		.limit(1)
		.get()?.outcome
}

/*
 * A configured engine is failing when its latest run was refused its credentials (`auth`); any other
 * outcome, or no run yet, reads as ok, since rate limits and timeouts pass on their own.
 */
function engineStatuses(db: Db, configured: readonly EngineId[]) {
	const statuses = allEngines('not configured')

	for (const engine of configured) {
		statuses[engine] = latestOutcome(db, engine) === 'auth' ? 'failing' : 'ok'
	}

	return statuses
}

function readEngines(db: Db, configuredEngines: HealthSources['configuredEngines']) {
	try {
		return engineStatuses(db, configuredEngines(db))
	} catch {
		// Settings that no longer validate leave no engine able to take a call.
		return allEngines('failing')
	}
}

export async function checkHealth(sources: HealthSources): Promise<Health> {
	const db = await workingDatabase(sources.db)
	const runner = sources.runner()?.status === 'healthy' ? 'ok' : 'failing'

	if (db === null) {
		return { database: 'failing', runner, engines: allEngines('failing') }
	}

	return { database: 'ok', runner, engines: readEngines(db, sources.configuredEngines) }
}

/** 200 with the health, or 503 when the database fails: without it the instance can do nothing. */
export async function healthResponse(sources: HealthSources): Promise<Response> {
	const health = await checkHealth(sources)
	const status = health.database === 'ok' ? 200 : 503

	return Response.json(health, { status, headers: { 'cache-control': 'no-store' } })
}
