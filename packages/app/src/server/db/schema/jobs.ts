// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { sql } from 'drizzle-orm'
import { index, integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core'

import { currentTime, timestamps } from './columns'

export const jobStatuses = ['queued', 'running', 'done', 'failed'] as const

export type JobStatus = (typeof jobStatuses)[number]

/** Background work for the job runner (D2): one row per unit of work. */
export const jobs = sqliteTable(
	'jobs',
	{
		id: integer('id').primaryKey(),
		kind: text('kind').notNull(),
		payload: text('payload', { mode: 'json' }).$type<unknown>().notNull().default({}),
		priority: integer('priority').notNull().default(0),
		runAt: integer('run_at', { mode: 'timestamp_ms' })
			.notNull()
			.default(currentTime)
			.$defaultFn(() => new Date()),
		status: text('status', { enum: jobStatuses }).notNull().default('queued'),
		attempts: integer('attempts').notNull().default(0),
		lastError: text('last_error'),
		startedAt: integer('started_at', { mode: 'timestamp_ms' }),
		finishedAt: integer('finished_at', { mode: 'timestamp_ms' }),
		...timestamps,
	},
	(table) => [
		// The runner's next job: queued and due, highest priority first, then oldest.
		index('jobs_queue_idx').on(table.status, sql`"priority" desc`, table.runAt),
	],
)

export const engineTasks = ['suggest', 'explain', 'research'] as const

export const engineOutcomes = ['ok', 'rate_limited', 'auth', 'timeout', 'invalid'] as const

/** One call to an engine, for usage limits and cost; a suggestion runs outside any job. */
export const engineRuns = sqliteTable(
	'engine_runs',
	{
		id: integer('id').primaryKey(),
		jobId: integer('job_id').references(() => jobs.id, { onDelete: 'set null' }),
		engine: text('engine').notNull(),
		model: text('model'),
		task: text('task', { enum: engineTasks }).notNull(),
		outcome: text('outcome', { enum: engineOutcomes }).notNull(),
		startedAt: integer('started_at', { mode: 'timestamp_ms' }).notNull(),
		durationMs: integer('duration_ms').notNull(),
		inputTokens: integer('input_tokens'),
		outputTokens: integer('output_tokens'),
		searches: integer('searches'),
		costUsd: real('cost_usd'),
	},
	(table) => [
		index('engine_runs_engine_started_at_idx').on(table.engine, table.startedAt),
		index('engine_runs_job_id_idx').on(table.jobId),
	],
)
