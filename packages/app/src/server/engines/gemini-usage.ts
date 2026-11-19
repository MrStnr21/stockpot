// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

/*
 * Gemini usage counters (docs/engines.md, "The Gemini engine"): requests per model in the last minute
 * and since midnight Pacific time, when Google resets its daily quotas. They live in memory, in the one
 * server process, behind `UsageCounters`, so they could move to a shared store if that ever became
 * necessary (docs/architecture.md). Only `gemini.ts` uses them.
 */
import { EngineError } from './contract'

/** The owner's limits for one tier's model; `null` sets no limit. */
export interface UsageLimit {
	readonly perMinute: number | null
	readonly perDay: number | null
}

export interface UsageCounters {
	/**
	 * Counts `requests` against `model`, or fails with `rate_limited`, counting nothing, when they would
	 * pass either limit. The error carries the time the blocking window frees enough room.
	 */
	take: (model: string, limit: UsageLimit, requests: number) => void
}

const minuteMs = 60_000

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

/** Counters that start at zero; the engine creates them once per process. */
export function createUsageCounters(): UsageCounters {
	const usage = new Map<string, ModelUsage>()

	return {
		take(model, { perMinute, perDay }, requests) {
			const now = Date.now()
			const today = pacificDay(now)
			const current = usage.get(model) ?? { minute: [], day: today, dayCount: 0 }
			const minute = current.minute.filter((time) => time > now - minuteMs)
			const dayCount = current.day === today ? current.dayCount : 0

			if (perDay !== null && dayCount + requests > perDay) {
				refuse(model, nextPacificMidnight(now).getTime(), 'daily')
			}

			if (perMinute !== null && minute.length + requests > perMinute) {
				// These fit once enough of the oldest requests leave the window; more than the limit never fits.
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
