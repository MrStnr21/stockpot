// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

/*
 * Gemini usage counters (docs/engines.md, "The Gemini engine"): requests per model in the last minute
 * and since midnight Pacific time, when Google resets its daily quotas. They live in memory, in the one
 * server process, behind `UsageCounters`, so they could move to a shared store if that ever became
 * necessary (docs/architecture.md); they start from the runs in `engine_runs`, so a restart keeps the
 * day's count. Only `gemini.ts` uses them.
 */
import { and, eq, gte, ne } from 'drizzle-orm'

import type { Db } from '#/server/db/client'
import { engineRuns } from '#/server/db/schema/jobs'

import { EngineError, type Task } from './contract'
import { maxQuestions } from './gemini-research'

/** The owner's limits for one tier's model; `null` sets no limit. */
export interface UsageLimit {
	readonly perMinute: number | null
	readonly perDay: number | null
}

export interface UsageCounters {
	/**
	 * Counts `requests` against `model`, or fails with `rate_limited`, counting nothing, when they would
	 * pass either limit. The error carries the time the blocking window frees enough room. A call that
	 * needs more requests than a limit allows never fits, so it fails with an ordinary error instead,
	 * which no wait would fix.
	 */
	take: (model: string, limit: UsageLimit, requests: number) => void
}

const minuteMs = 60_000

// Long enough to hold a whole Pacific day, even the 25-hour one when daylight saving time ends.
const pacificDayMs = 25 * 3_600_000

/**
 * How many requests a call takes: a card is the facts, then the card, and an idea report is a plan,
 * a search for each of the most questions it may plan, and the report. A report that plans fewer
 * questions is counted in full too, which errs on the side of the limit.
 */
export function requestsPerCall(task: Task): number {
	if (task === 'research') {
		return maxQuestions + 2
	}

	return task === 'suggest' ? 1 : 2
}

/** Requests an engine made before the counters started: when, to which model and how many. */
export interface PastRequests {
	readonly model: string
	readonly at: number
	readonly requests: number
}

/**
 * The engine's runs of the last Pacific day, as requests. A run refused as `rate_limited`, by the
 * counters or by Google, is left out; any other run counts in full, even one that failed before a
 * request, which errs on the side of the limit. A run counts against the model it records, which is
 * the model Gemini reported.
 */
export function pastRequests(db: Db, engine: string): PastRequests[] {
	const since = new Date(Date.now() - pacificDayMs)

	const columns = {
		model: engineRuns.model,
		task: engineRuns.task,
		startedAt: engineRuns.startedAt,
	}

	const runs = db
		.select(columns)
		.from(engineRuns)
		.where(
			and(
				eq(engineRuns.engine, engine),
				gte(engineRuns.startedAt, since),
				ne(engineRuns.outcome, 'rate_limited'),
			),
		)
		.all()

	return runs.flatMap(({ model, task, startedAt }) =>
		model === null ? [] : [{ model, at: startedAt.getTime(), requests: requestsPerCall(task) }],
	)
}

const pacific = new Intl.DateTimeFormat('en-US', {
	timeZone: 'America/Los_Angeles',
	year: 'numeric',
	month: 'numeric',
	day: 'numeric',
	hour: 'numeric',
	minute: 'numeric',
	second: 'numeric',
	hourCycle: 'h23',
})

function pacificParts(time: number) {
	const parts = new Map<string, number>(
		pacific.formatToParts(time).map(({ type, value }) => [type, Number(value)]),
	)

	function part(type: string) {
		return parts.get(type) ?? 0
	}

	return {
		year: part('year'),
		month: part('month'),
		day: part('day'),
		hour: part('hour'),
		minute: part('minute'),
		second: part('second'),
	}
}

/** How far Pacific wall-clock time is ahead of UTC at `time` (negative: it is behind). */
function pacificOffsetMs(time: number) {
	const { year, month, day, hour, minute, second } = pacificParts(time)
	const wholeSecond = Math.floor(time / 1000) * 1000

	return Date.UTC(year, month - 1, day, hour, minute, second) - wholeSecond
}

/** The calendar day in Pacific time, such as `2026-11-19`. */
export function pacificDay(time: number): string {
	const { year, month, day } = pacificParts(time)

	return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

/** The next midnight in Pacific time after `time`, when Google resets daily quotas. */
export function nextPacificMidnight(time: number): Date {
	const { year, month, day } = pacificParts(time)
	const midnightOnTheClock = Date.UTC(year, month - 1, day + 1)
	const guess = midnightOnTheClock - pacificOffsetMs(time)

	// The offset at midnight itself, which differs from now's on the day daylight saving time changes.
	return new Date(midnightOnTheClock - pacificOffsetMs(guess))
}

interface ModelUsage {
	/** The times of the requests in the last minute, oldest first. */
	minute: number[]
	day: string
	dayCount: number
}

function refuse(model: string, resetsAt: number, window: string): never {
	throw new EngineError(
		{ kind: 'rate_limited', resetsAt: new Date(resetsAt) },
		`The configured ${window} limit for ${model} is reached`,
	)
}

/** Counts the past requests of today and of the last minute into each model's usage. */
function seed(past: readonly PastRequests[]): Map<string, ModelUsage> {
	const now = Date.now()
	const today = pacificDay(now)
	const usage = new Map<string, ModelUsage>()

	for (const { model, at, requests } of past) {
		const current = usage.get(model) ?? { minute: [], day: today, dayCount: 0 }
		const times = at > now - minuteMs ? Array.from({ length: requests }, () => at) : []
		const dayCount = pacificDay(at) === today ? current.dayCount + requests : current.dayCount

		usage.set(model, { minute: [...current.minute, ...times], day: today, dayCount })
	}

	for (const current of usage.values()) {
		current.minute.sort((a, b) => a - b)
	}

	return usage
}

/** Counters that start from `past`; the engine creates them once, from its runs in `engine_runs`. */
export function createUsageCounters(past: readonly PastRequests[] = []): UsageCounters {
	const usage = seed(past)

	return {
		take(model, { perMinute, perDay }, requests) {
			const most = Math.min(perMinute ?? Infinity, perDay ?? Infinity)

			if (requests > most) {
				throw new Error(
					`A call of ${requests} requests never fits the configured limit of ${most} for ${model}`,
				)
			}

			const now = Date.now()
			const today = pacificDay(now)
			const current = usage.get(model) ?? { minute: [], day: today, dayCount: 0 }
			const minute = current.minute.filter((time) => time > now - minuteMs)
			const dayCount = current.day === today ? current.dayCount : 0

			if (perDay !== null && dayCount + requests > perDay) {
				refuse(model, nextPacificMidnight(now).getTime(), 'daily')
			}

			if (perMinute !== null && minute.length + requests > perMinute) {
				// These fit once enough of the oldest requests leave the window.
				const leaving = minute.at(minute.length + requests - perMinute - 1)

				refuse(model, (leaving ?? now) + minuteMs, 'per-minute')
			}

			for (let index = 0; index < requests; index += 1) {
				minute.push(now)
			}

			usage.set(model, { minute, day: today, dayCount: dayCount + requests })
		},
	}
}
