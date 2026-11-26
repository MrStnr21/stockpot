// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { describe, expect, it } from 'bun:test'
import { listedNoteFactory } from '#tests/factories/listed-notes'

import { groupByDay } from './day-groups'

const labels = { today: 'Today', yesterday: 'Yesterday', thisWeek: 'This week' }

function rowsAt(...times: string[]) {
	return times.map((createdAt) => listedNoteFactory.build({ createdAt }))
}

function summary(groups: ReturnType<typeof groupByDay>) {
	return groups.map(({ key, label, rows }) => [key, label, rows.length])
}

describe('groupByDay', () => {
	it('groups by today, yesterday, this week, then by month', () => {
		const rows = rowsAt(
			'2026-11-26T08:00:00Z',
			'2026-11-26T00:00:00Z',
			'2026-11-25T23:59:59Z',
			'2026-11-24T12:00:00Z',
			'2026-11-20T00:00:00Z',
			'2026-11-19T23:59:59Z',
			'2026-11-01T00:00:00Z',
			'2026-10-31T23:00:00Z',
		)

		const groups = groupByDay(rows, {
			now: Date.parse('2026-11-26T10:00:00Z'),
			timeZone: 'UTC',
			locale: 'en',
			labels,
		})

		expect(summary(groups)).toEqual([
			['today', 'Today', 2],
			['yesterday', 'Yesterday', 1],
			['week', 'This week', 2],
			['2026-11', 'November 2026', 2],
			['2026-10', 'October 2026', 1],
		])
	})

	it('moves the day at midnight in the instance time zone', () => {
		const rows = rowsAt('2026-11-25T23:58:00Z', '2026-11-25T23:30:00Z')
		const options = { timeZone: 'UTC', locale: 'en', labels }

		const before = groupByDay(rows, { ...options, now: Date.parse('2026-11-25T23:59:00Z') })
		const after = groupByDay(rows, { ...options, now: Date.parse('2026-11-26T00:01:00Z') })

		expect(summary(before)).toEqual([['today', 'Today', 2]])
		expect(summary(after)).toEqual([['yesterday', 'Yesterday', 2]])
	})

	it('judges the day in a time zone ahead of UTC', () => {
		// Auckland is UTC+13 in November: 11:30 UTC on the 25th is already the 26th there.
		const rows = rowsAt('2026-11-25T11:30:00Z', '2026-11-25T10:30:00Z')

		const groups = groupByDay(rows, {
			now: Date.parse('2026-11-25T20:00:00Z'),
			timeZone: 'Pacific/Auckland',
			locale: 'en',
			labels,
		})

		expect(summary(groups)).toEqual([
			['today', 'Today', 1],
			['yesterday', 'Yesterday', 1],
		])
	})

	it('names months in the owner’s language and the instance time zone', () => {
		const rows = rowsAt('2026-08-31T22:00:00Z')

		const groups = groupByDay(rows, {
			now: Date.parse('2026-11-26T10:00:00Z'),
			timeZone: 'Europe/Moscow',
			locale: 'ru',
			labels,
		})

		expect(summary(groups)).toEqual([['2026-09', 'сентябрь 2026 г.', 1]])
	})

	it('puts a note from a clock ahead of the server under today', () => {
		const groups = groupByDay(rowsAt('2026-11-27T10:00:00Z'), {
			now: Date.parse('2026-11-26T10:00:00Z'),
			timeZone: 'UTC',
			locale: 'en',
			labels,
		})

		expect(summary(groups)).toEqual([['today', 'Today', 1]])
	})
})
