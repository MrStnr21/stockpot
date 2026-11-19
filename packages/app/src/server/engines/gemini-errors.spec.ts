// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { afterEach, beforeEach, describe, expect, it, setSystemTime } from 'bun:test'
import badKey from '#tests/recordings/gemini/bad-key.json'
import quotaExceeded from '#tests/recordings/gemini/quota-exceeded.json'
import unavailable from '#tests/recordings/gemini/unavailable.json'

import { EngineError } from './contract'
import { geminiFailure } from './gemini-errors'

const apiKey = 'test-key-a'

function apiError(status: number, details: readonly object[]) {
	const body = { error: { code: status, message: 'Failed', status: 'FAILED', details } }

	return { status, message: JSON.stringify(body) }
}

function recorded({ status, body }: { status: number; body: object }) {
	return { status, message: JSON.stringify(body) }
}

describe('geminiFailure', () => {
	beforeEach(() => {
		setSystemTime(new Date('2026-11-19T15:00:00Z'))
	})

	afterEach(() => {
		setSystemTime()
	})

	describe('with a 429', () => {
		it.each([
			[
				'after the retry delay',
				[{ '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '31.5s' }],
				'2026-11-19T15:00:31.500Z',
			],
			[
				'at midnight Pacific for a daily quota',
				[
					{
						'@type': 'type.googleapis.com/google.rpc.QuotaFailure',
						violations: [{ quotaId: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier' }],
					},
				],
				'2026-11-20T08:00:00.000Z',
			],
			[
				'at midnight Pacific for a daily quota that also names a short retry delay',
				[
					{ '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '43s' },
					{
						'@type': 'type.googleapis.com/google.rpc.QuotaFailure',
						violations: [{ quotaId: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier' }],
					},
				],
				'2026-11-20T08:00:00.000Z',
			],
			['a minute from now without either', [], '2026-11-19T15:01:00.000Z'],
		])('is rate_limited until %s', (_, details, resetsAt) => {
			expect(geminiFailure(apiError(429, details), apiKey)).toMatchObject({
				failure: { kind: 'rate_limited', resetsAt: new Date(resetsAt) },
			})
		})

		it('reads the recorded quota error as a minute', () => {
			expect(geminiFailure(recorded(quotaExceeded), apiKey)).toMatchObject({
				failure: { kind: 'rate_limited', resetsAt: new Date('2026-11-19T15:01:00Z') },
			})
		})

		it('reads a message that is not JSON as a minute', () => {
			expect(geminiFailure({ status: 429, message: 'Too many' }, apiKey)).toMatchObject({
				failure: { resetsAt: new Date('2026-11-19T15:01:00Z') },
			})
		})
	})

	describe('with a rejected key', () => {
		it.each([401, 403])('is auth for %d', (status) => {
			expect(geminiFailure(apiError(status, []), apiKey)).toMatchObject({
				failure: { kind: 'auth' },
			})
		})

		it("is auth for the recorded 400 with Gemini's API_KEY_INVALID reason", () => {
			expect(geminiFailure(recorded(badKey), apiKey)).toMatchObject({ failure: { kind: 'auth' } })
		})
	})

	describe('with any other status', () => {
		it('is an ordinary error that names the status', () => {
			const error = geminiFailure(recorded(unavailable), apiKey)

			expect(error).not.toBeInstanceOf(EngineError)
			expect(error.message).toStartWith('Gemini answered 503: ')
		})

		it('never carries the key', () => {
			const error = geminiFailure({ status: 500, message: `Bad key ${apiKey}` }, apiKey)

			expect(error.message).toBe('Gemini answered 500: Bad key [key]')
		})
	})
})
