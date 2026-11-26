// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

/*
 * The list's day groups, by the calendar day a note was created on in the instance's time zone:
 * Today, Yesterday, This week (two to six days ago), then one group per month. The days are judged
 * against a fixed time (when the page was rendered, then when each first page arrived), so the island
 * draws the same groups as the server-rendered HTML it hydrates.
 */
import type { NoteRow } from '../shared/types'

export interface DayGroupLabels {
	readonly today: string
	readonly yesterday: string
	readonly thisWeek: string
}

export interface DayGroupOptions {
	/** The time "today" is judged at, in ms. */
	readonly now: number
	readonly timeZone: string
	readonly locale: string
	readonly labels: DayGroupLabels
}

export interface DayGroup {
	/** Stable across renders: `today`, `yesterday`, `week`, or `YYYY-MM`. */
	readonly key: string
	readonly label: string
	readonly rows: readonly NoteRow[]
}

const dayMs = 86_400_000

const lastWeekDay = 6

interface CalendarDay {
	readonly year: number
	readonly month: number
	/** Days since 1970-01-01 for this calendar date. */
	readonly index: number
}

function calendarDay(parts: Intl.DateTimeFormat, time: number): CalendarDay {
	const values = new Map(parts.formatToParts(time).map(({ type, value }) => [type, Number(value)]))
	const year = values.get('year') ?? 1970
	const month = values.get('month') ?? 1
	const day = values.get('day') ?? 1

	return { year, month, index: Date.UTC(year, month - 1, day) / dayMs }
}

export function groupByDay(rows: readonly NoteRow[], options: DayGroupOptions): DayGroup[] {
	const { now, timeZone, locale, labels } = options

	const parts = new Intl.DateTimeFormat('en-US', {
		timeZone,
		year: 'numeric',
		month: 'numeric',
		day: 'numeric',
	})

	const monthLabel = new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric', timeZone })
	const today = calendarDay(parts, now).index
	const groups = new Map<string, { label: string; rows: NoteRow[] }>()

	for (const row of rows) {
		const created = Date.parse(row.createdAt)
		const day = calendarDay(parts, created)
		const daysAgo = today - day.index
		let key = `${day.year}-${String(day.month).padStart(2, '0')}`
		let label: string | null = null

		if (daysAgo <= 0) {
			key = 'today'
			label = labels.today
		} else if (daysAgo === 1) {
			key = 'yesterday'
			label = labels.yesterday
		} else if (daysAgo <= lastWeekDay) {
			key = 'week'
			label = labels.thisWeek
		}

		const group = groups.get(key)

		if (group === undefined) {
			groups.set(key, { label: label ?? monthLabel.format(created), rows: [row] })
		} else {
			group.rows.push(row)
		}
	}

	return [...groups].map(([key, { label, rows: grouped }]) => ({ key, label, rows: grouped }))
}
