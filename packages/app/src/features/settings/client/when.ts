// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

/** The relative-time texts; `{n}` and `{time}` are filled in. */
export interface WhenStrings {
	readonly justNow: string
	readonly minutesAgo: string
	readonly today: string
	readonly yesterday: string
}

export interface WhenOptions {
	/** The moment to count from; pages pass the server's, so the first render matches. */
	readonly now: Date
	readonly locale: string
	/** The digest time zone: "today" and the clock time are read there. */
	readonly timeZone: string
	readonly strings: WhenStrings
}

const minuteMs = 60_000

const dayMs = 24 * 60 * minuteMs

function calendarDay(date: Date, timeZone: string) {
	return new Intl.DateTimeFormat('en-CA', {
		timeZone,
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
	}).format(date)
}

/** The calendar day before `day` (`YYYY-MM-DD`), counted on dates so a DST change cannot shift it. */
function dayBefore(day: string) {
	return new Date(Date.parse(`${day}T00:00:00Z`) - dayMs).toISOString().slice(0, 10)
}

/**
 * When something happened, as the settings pages say it: "just now" within a minute (a clock a
 * little ahead included), "{n} min ago" within the hour, "today, HH:MM", "yesterday, HH:MM", else the
 * day and month, such as "3 Nov".
 */
export function formatWhen(iso: string, { now, locale, timeZone, strings }: WhenOptions): string {
	const then = new Date(iso)
	const ago = now.getTime() - then.getTime()

	if (ago < minuteMs) {
		return strings.justNow
	}

	if (ago < 60 * minuteMs) {
		return strings.minutesAgo.replaceAll('{n}', String(Math.floor(ago / minuteMs)))
	}

	const time = new Intl.DateTimeFormat(locale, {
		timeZone,
		hour: '2-digit',
		minute: '2-digit',
		hourCycle: 'h23',
	}).format(then)

	const day = calendarDay(then, timeZone)
	const today = calendarDay(now, timeZone)

	if (day === today) {
		return strings.today.replaceAll('{time}', time)
	}

	if (day === dayBefore(today)) {
		return strings.yesterday.replaceAll('{time}', time)
	}

	// English puts the day first, as the boards do ("3 Nov", not "Nov 3").
	return new Intl.DateTimeFormat(locale === 'en' ? 'en-GB' : locale, {
		timeZone,
		day: 'numeric',
		month: 'short',
	}).format(then)
}
