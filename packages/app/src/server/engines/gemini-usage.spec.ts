// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { afterEach, beforeEach, describe, expect, it, setSystemTime } from 'bun:test'

import { EngineError } from './contract'
import {
	createUsageCounters,
	nextPacificMidnight,
	type UsageCounters,
	type UsageLimit,
} from './gemini-usage'

const noLimit = { perMinute: null, perDay: null }

describe('gemini-usage', () => {
	afterEach(() => {
		setSystemTime()
	})

	describe('nextPacificMidnight', () => {
		it.each([
			['a winter morning', '2026-11-19T15:00:00Z', '2026-11-20T08:00:00Z'],
			['a summer noon', '2026-07-01T19:00:00Z', '2026-07-02T07:00:00Z'],
			['the evening before daylight saving starts', '2026-03-08T07:30:00Z', '2026-03-08T08:00:00Z'],
			['the day daylight saving starts', '2026-03-08T12:00:00Z', '2026-03-09T07:00:00Z'],
			['the evening before daylight saving ends', '2026-11-01T06:30:00Z', '2026-11-01T07:00:00Z'],
			['the day daylight saving ends', '2026-11-01T12:00:00Z', '2026-11-02T08:00:00Z'],
		])('finds midnight after %s', (_, now, midnight) => {
			expect(nextPacificMidnight(Date.parse(now)).toISOString()).toBe(
				new Date(midnight).toISOString(),
			)
		})
	})

	describe('createUsageCounters', () => {
		let counters: UsageCounters

		/** The failure of a take, or `null` when it was counted. */
		function refusal(model: string, limit: UsageLimit, requests = 1): Error | null {
			try {
				counters.take(model, limit, requests)

				return null
			} catch (error) {
				if (error instanceof Error) {
					return error
				}

				throw error
			}
		}

		beforeEach(() => {
			setSystemTime(new Date('2026-11-19T15:00:00Z'))
			counters = createUsageCounters()
		})

		it('never refuses without limits', () => {
			const results = Array.from({ length: 50 }, () => refusal('model-a', noLimit))

			expect(results.every((result) => result === null)).toBe(true)
		})

		describe('with a daily limit', () => {
			const daily = { perMinute: null, perDay: 2 }

			it('refuses the call past the limit until midnight Pacific', () => {
				refusal('model-a', daily)
				refusal('model-a', daily)

				const error = refusal('model-a', daily)

				expect(error).toBeInstanceOf(EngineError)
				expect(error).toMatchObject({
					failure: { kind: 'rate_limited', resetsAt: new Date('2026-11-20T08:00:00Z') },
				})
			})

			it('starts counting again after midnight Pacific', () => {
				refusal('model-a', daily, 2)
				setSystemTime(new Date('2026-11-20T08:00:01Z'))

				expect(refusal('model-a', daily, 2)).toBeNull()
			})

			it('counts nothing for a refused call', () => {
				const three = { perMinute: null, perDay: 3 }

				refusal('model-a', three, 2)
				const refused = refusal('model-a', three, 2)

				expect(refused).toBeInstanceOf(EngineError)
				expect(refusal('model-a', three, 1)).toBeNull()
			})

			it('counts each model on its own', () => {
				refusal('model-a', daily, 2)

				expect(refusal('model-b', daily, 2)).toBeNull()
			})
		})

		describe('with a per-minute limit', () => {
			const perMinute = { perMinute: 2, perDay: null }

			beforeEach(() => {
				refusal('model-a', perMinute)
				setSystemTime(new Date('2026-11-19T15:00:20Z'))
				refusal('model-a', perMinute)
				setSystemTime(new Date('2026-11-19T15:00:30Z'))
			})

			it('refuses until the oldest request leaves the minute', () => {
				expect(refusal('model-a', perMinute)).toMatchObject({
					failure: { kind: 'rate_limited', resetsAt: new Date('2026-11-19T15:01:00Z') },
				})
			})

			it('waits for as many requests as a call needs', () => {
				expect(refusal('model-a', perMinute, 2)).toMatchObject({
					failure: { resetsAt: new Date('2026-11-19T15:01:20Z') },
				})
			})

			it('takes a call again once the minute has passed', () => {
				setSystemTime(new Date('2026-11-19T15:01:00.001Z'))

				expect(refusal('model-a', perMinute)).toBeNull()
			})
		})
	})
})
