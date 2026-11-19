// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { beforeEach, describe, expect, it } from 'bun:test'

import { createBackoff, forgetAfter, freeAttempts, longestWait, type Backoff } from './backoff'

const start = Date.parse('2026-11-19T12:00:00Z')

describe('createBackoff', () => {
	let backoff: Backoff

	beforeEach(() => {
		backoff = createBackoff()
	})

	function failTimes(count: number, at = start) {
		for (let attempt = 0; attempt < count; attempt += 1) {
			backoff.fail(at)
		}
	}

	it('lets the free attempts through without a wait', () => {
		failTimes(freeAttempts - 1)

		expect(backoff.wait(start)).toBe(0)
	})

	it('doubles the wait with each failure past the free ones', () => {
		const waits = [0, 1, 2, 3].map((extra) => {
			const next = createBackoff()

			for (let attempt = 0; attempt < freeAttempts + extra; attempt += 1) {
				next.fail(start)
			}

			return next.wait(start)
		})

		expect(waits).toEqual([1000, 2000, 4000, 8000])
	})

	it('never waits longer than the longest wait', () => {
		failTimes(100)

		expect(backoff.wait(start)).toBe(longestWait)
	})

	it('counts down the wait from the last failure', () => {
		failTimes(freeAttempts + 1)

		expect([backoff.wait(start + 500), backoff.wait(start + 2000)]).toEqual([1500, 0])
	})

	it('forgets the failures after a quiet hour', () => {
		failTimes(100)

		expect(backoff.wait(start + forgetAfter)).toBe(0)
	})

	it('forgives the failures on success', () => {
		failTimes(10)
		backoff.succeed()

		expect(backoff.wait(start)).toBe(0)
	})
})
