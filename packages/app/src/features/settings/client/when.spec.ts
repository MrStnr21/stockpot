// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { describe, expect, it } from 'bun:test'

import { en } from '#/lib/i18n/en'
import { ru } from '#/lib/i18n/ru'

import { formatWhen, type WhenOptions } from './when'

// 10:00 on 15 March 2026 in Berlin (UTC+1).
const now = new Date('2026-03-15T09:00:00Z')

const berlin: WhenOptions = {
	now,
	locale: 'en',
	timeZone: 'Europe/Berlin',
	strings: en.settings.when,
}

describe('formatWhen', () => {
	it.each([
		['2026-03-15T08:59:30Z', 'just now'],
		['2026-03-15T09:00:20Z', 'just now'],
		['2026-03-15T08:59:00Z', '1 min ago'],
		['2026-03-15T08:00:01Z', '59 min ago'],
		['2026-03-15T08:00:00Z', 'today, 09:00'],
		['2026-03-14T23:00:00Z', 'today, 00:00'],
		['2026-03-14T22:59:00Z', 'yesterday, 23:59'],
		['2026-03-13T23:00:00Z', 'yesterday, 00:00'],
		['2026-03-13T22:59:00Z', '13 Mar'],
		['2025-11-03T12:00:00Z', '3 Nov'],
	])('says %s as “%s”', (iso, expected) => {
		expect(formatWhen(iso, berlin)).toBe(expected)
	})

	it('reads the day in the given time zone', () => {
		expect(formatWhen('2026-03-14T23:30:00Z', { ...berlin, timeZone: 'UTC' })).toBe(
			'yesterday, 23:30',
		)
	})

	it('counts yesterday by the calendar across a clock change', () => {
		// Berlin moves to summer time at 02:00 on 29 March 2026.
		expect(
			formatWhen('2026-03-28T22:30:00Z', { ...berlin, now: new Date('2026-03-29T21:30:00Z') }),
		).toBe('yesterday, 23:30')
	})

	it('speaks Russian without plural forms', () => {
		const options = { ...berlin, locale: 'ru', strings: ru.settings.when }

		expect(formatWhen('2026-03-15T08:55:00Z', options)).toBe('5 мин назад')
		expect(formatWhen('2026-03-14T20:00:00Z', options)).toBe('вчера, 21:00')
		expect(formatWhen('2025-11-03T12:00:00Z', options)).toBe('3 нояб.')
	})
})
