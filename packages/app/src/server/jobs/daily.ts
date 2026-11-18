// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

/** A run of a daily schedule: when it happens and the local date it belongs to, such as '2026-11-18'. */
export interface DailyRun {
	runAt: Date
	day: string
}

const timeOfDay = /^(?:[01]\d|2[0-3]):[0-5]\d$/u

/** Reads a local time of day written as 'HH:MM', such as '07:00'. */
export function parseTimeOfDay(text: string): Temporal.PlainTime {
	if (!timeOfDay.test(text)) {
		throw new Error(`"${text}" is not a time of day written as HH:MM`)
	}

	return Temporal.PlainTime.from(text)
}

/*
 * Temporal's default disambiguation decides the DST days: a time skipped when the clocks go forward
 * runs as much later as the clocks moved (02:30 becomes 03:30), and a time repeated when they go
 * back runs at its first occurrence only.
 */
function runOn(date: Temporal.PlainDate, at: Temporal.PlainTime, timeZone: string): DailyRun {
	const run = date.toZonedDateTime({ timeZone, plainTime: at })

	return { runAt: new Date(run.epochMilliseconds), day: date.toString() }
}

function localDate(instant: Date, timeZone: string) {
	return Temporal.Instant.fromEpochMilliseconds(instant.getTime())
		.toZonedDateTimeISO(timeZone)
		.toPlainDate()
}

/** The first run strictly after `after`. */
export function nextDailyRun(after: Date, at: Temporal.PlainTime, timeZone: string): DailyRun {
	const today = localDate(after, timeZone)
	const run = runOn(today, at, timeZone)

	return run.runAt > after ? run : runOn(today.add({ days: 1 }), at, timeZone)
}

/** The last run at or before `now`. */
export function latestDailyRun(now: Date, at: Temporal.PlainTime, timeZone: string): DailyRun {
	const today = localDate(now, timeZone)
	const run = runOn(today, at, timeZone)

	return run.runAt <= now ? run : runOn(today.subtract({ days: 1 }), at, timeZone)
}
