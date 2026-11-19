// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

/*
 * Prometheus metrics behind `/metrics`, read from the `jobs` and `engine_runs` tables on each scrape,
 * so they survive a restart and need no counters in memory. The route is off unless the environment
 * sets `STOCKPOT_METRICS_TOKEN` (src/server/config.ts), and then it takes that bearer token only.
 */
import { count, sql, sum } from 'drizzle-orm'

import { secretsMatch } from '#/server/auth/tokens'
import type { Db } from '#/server/db/client'
import { engineRuns, jobs } from '#/server/db/schema/jobs'
import { jsonError } from '#/server/http'

/** The Prometheus text exposition format, version 0.0.4. */
export const metricsContentType = 'text/plain; version=0.0.4; charset=utf-8'

type Labels = Readonly<Record<string, string>>

interface Sample {
	readonly name: string
	readonly labels: Labels
	readonly value: number
}

interface Family {
	readonly name: string
	readonly type: 'gauge' | 'counter' | 'summary'
	readonly help: string
	readonly samples: readonly Sample[]
}

// The only escapes the format has for a label value: backslash, double quote and line feed.
function escapeLabel(value: string) {
	return value
		.replaceAll('\\', String.raw`\\`)
		.replaceAll('"', String.raw`\"`)
		.replaceAll('\n', String.raw`\n`)
}

function formatSample({ name, labels, value }: Sample) {
	const pairs = Object.entries(labels).map(([label, text]) => `${label}="${escapeLabel(text)}"`)

	return `${name}{${pairs.join(',')}} ${value}`
}

function formatFamily({ name, type, help, samples }: Family) {
	return [
		`# HELP ${name} ${help}`,
		`# TYPE ${name} ${type}`,
		...samples.map((sample) => formatSample(sample)),
	]
}

// One scan of each table: a personal instance keeps thousands of rows, not millions.
function jobFamilies(db: Db): Family[] {
	const rows = db
		.select({
			kind: jobs.kind,
			status: jobs.status,
			jobs: count(),
			attempts: sql<number>`coalesce(${sum(jobs.attempts)}, 0)`.mapWith(Number),
		})
		.from(jobs)
		.groupBy(jobs.kind, jobs.status)
		.orderBy(jobs.kind, jobs.status)
		.all()

	return [
		{
			name: 'stockpot_jobs',
			type: 'gauge',
			help: 'Jobs in the queue and its history, by kind and status.',
			samples: rows.map(({ kind, status, jobs: value }) => ({
				name: 'stockpot_jobs',
				labels: { kind, status },
				value,
			})),
		},
		{
			name: 'stockpot_job_attempts',
			type: 'gauge',
			help: 'Attempts made by those jobs, retries included, by kind and status.',
			samples: rows.map(({ kind, status, attempts: value }) => ({
				name: 'stockpot_job_attempts',
				labels: { kind, status },
				value,
			})),
		},
	]
}

function engineRunFamilies(db: Db): Family[] {
	const rows = db
		.select({
			engine: engineRuns.engine,
			outcome: engineRuns.outcome,
			runs: count(),
			durationMs: sql<number>`coalesce(${sum(engineRuns.durationMs)}, 0)`.mapWith(Number),
		})
		.from(engineRuns)
		.groupBy(engineRuns.engine, engineRuns.outcome)
		.orderBy(engineRuns.engine, engineRuns.outcome)
		.all()

	const name = 'stockpot_engine_run_duration_seconds'

	return [
		{
			name,
			type: 'summary',
			help: 'Engine calls and how long they took, by engine and outcome.',
			samples: rows.flatMap(({ engine, outcome, runs, durationMs }) => [
				{ name: `${name}_sum`, labels: { engine, outcome }, value: durationMs / 1000 },
				{ name: `${name}_count`, labels: { engine, outcome }, value: runs },
			]),
		},
	]
}

/** Every metric, in the text format, ending with a line feed as the format asks. */
export function renderMetrics(db: Db): string {
	const families = [...jobFamilies(db), ...engineRunFamilies(db)]

	return `${families.flatMap((family) => formatFamily(family)).join('\n')}\n`
}

export interface MetricsAccess {
	/** `STOCKPOT_METRICS_TOKEN`, or `null` when metrics are off. */
	readonly token: string | null
	readonly db: () => Promise<Db>
}

const bearer = /^Bearer +(?<token>\S+) *$/iu

/** The bearer token of a request, or an empty string, which never matches a configured token. */
function bearerToken(request: Request) {
	return bearer.exec(request.headers.get('authorization') ?? '')?.groups?.token ?? ''
}

/**
 * 404 while metrics are off, so the route looks absent; 401 without the right bearer token, compared
 * in constant time; otherwise 200 with the metrics.
 */
export async function metricsResponse(request: Request, access: MetricsAccess): Promise<Response> {
	if (access.token === null) {
		return jsonError(404, { code: 'not_found', message: 'There is no such route.' })
	}

	if (!secretsMatch(bearerToken(request), access.token)) {
		const response = jsonError(401, {
			code: 'unauthorized',
			message: 'Send the metrics token as a bearer token.',
		})

		response.headers.set('www-authenticate', 'Bearer')

		return response
	}

	const text = renderMetrics(await access.db())

	return new Response(text, {
		headers: { 'content-type': metricsContentType, 'cache-control': 'no-store' },
	})
}
