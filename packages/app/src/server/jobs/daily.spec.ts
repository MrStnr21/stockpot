// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { describe, expect, it } from 'bun:test'

import { latestDailyRun, nextDailyRun, parseTimeOfDay } from './daily'

describe('daily runs', () => {
	describe('nextDailyRun', () => {
		it.each([
			[
				'later the same day',
				{
					timeZone: 'Asia/Tokyo',
					at: '07:00',
					after: '2026-11-17T21:00:00Z',
					runAt: '2026-11-17T22:00:00Z',
					day: '2026-11-18',
				},
			],
			[
				'on the next day',
				{
					timeZone: 'Asia/Tokyo',
					at: '07:00',
					after: '2026-11-18T12:00:00Z',
					runAt: '2026-11-18T22:00:00Z',
					day: '2026-11-19',
				},
			],
			[
				'an hour late on the day the clocks go forward',
				{
					timeZone: 'Europe/Berlin',
					at: '02:30',
					after: '2026-03-28T12:00:00Z',
					runAt: '2026-03-29T01:30:00Z',
					day: '2026-03-29',
				},
			],
			[
				'at the first 01:30 on the day the clocks go back',
				{
					timeZone: 'America/New_York',
					at: '01:30',
					after: '2026-10-31T12:00:00Z',
					runAt: '2026-11-01T05:30:00Z',
					day: '2026-11-01',
				},
			],
			[
				'on the next day after the first 01:30',
				{
					timeZone: 'America/New_York',
					at: '01:30',
					after: '2026-11-01T05:30:00Z',
					runAt: '2026-11-02T06:30:00Z',
					day: '2026-11-02',
				},
			],
		])('plans the run %s', (_case, { timeZone, at, after, runAt, day }) => {
			expect(nextDailyRun(new Date(after), parseTimeOfDay(at), timeZone)).toEqual({
				runAt: new Date(runAt),
				day,
			})
		})
	})

	describe('latestDailyRun', () => {
		it.each([
			[
				'the same day',
				{ now: '2026-11-18T23:00:00Z', runAt: '2026-11-18T22:00:00Z', day: '2026-11-19' },
			],
			[
				'the day before',
				{ now: '2026-11-18T12:00:00Z', runAt: '2026-11-17T22:00:00Z', day: '2026-11-18' },
			],
			[
				'at the exact time',
				{ now: '2026-11-18T22:00:00Z', runAt: '2026-11-18T22:00:00Z', day: '2026-11-19' },
			],
		])('finds the run %s', (_case, { now, runAt, day }) => {
			expect(latestDailyRun(new Date(now), parseTimeOfDay('07:00'), 'Asia/Tokyo')).toEqual({
				runAt: new Date(runAt),
				day,
			})
		})
	})

	describe('parseTimeOfDay', () => {
		it.each(['7:00', '24:00', '07:60', '07:00:00'])('rejects %s', (text) => {
			expect(() => parseTimeOfDay(text)).toThrow('is not a time of day written as HH:MM')
		})
	})
})
