// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import {
	afterEach,
	beforeEach,
	describe,
	expect,
	it,
	mock,
	setSystemTime,
	type Mock,
} from 'bun:test'
import { faker } from '@faker-js/faker'

import { createLogger, redacted, type Fields, type Logger, type Sink } from './log'

describe('createLogger', () => {
	let sink: Mock<Sink>
	let logger: Logger

	/** The one line the logger wrote. */
	function writtenLine() {
		return sink.mock.calls[0]?.[1] ?? ''
	}

	beforeEach(() => {
		setSystemTime(new Date('2026-11-19T08:30:00Z'))
		sink = mock()
		logger = createLogger(sink)
	})

	afterEach(() => {
		setSystemTime()
	})

	describe('with fields', () => {
		beforeEach(() => {
			logger.warn('The engine is slow', { engine: 'gemini', durationMs: 4200 })
		})

		it('writes one JSON line with the level, the time, the message and the fields', () => {
			expect(JSON.parse(writtenLine())).toEqual({
				level: 'warn',
				time: '2026-11-19T08:30:00.000Z',
				message: 'The engine is slow',
				engine: 'gemini',
				durationMs: 4200,
			})
		})

		it('passes the level on, for the sink to pick the stream', () => {
			expect(sink).toHaveBeenCalledWith('warn', expect.any(String))
		})
	})

	describe('with fields named like a secret', () => {
		const secret = faker.string.alphanumeric(40)

		const fields: Fields = {
			apiKey: secret,
			password: secret,
			sessionToken: secret,
			headers: { Authorization: `Bearer ${secret}`, cookie: secret, accept: 'text/plain' },
			engines: [{ id: 'gemini', api_key: secret }],
		}

		beforeEach(() => {
			logger.error('A request failed', fields)
		})

		it('never prints them, at any depth', () => {
			expect(writtenLine()).not.toContain(secret)
		})

		it('keeps the field names and every other value', () => {
			expect(JSON.parse(writtenLine())).toMatchObject({
				apiKey: redacted,
				password: redacted,
				sessionToken: redacted,
				headers: { Authorization: redacted, cookie: redacted, accept: 'text/plain' },
				engines: [{ id: 'gemini', api_key: redacted }],
			})
		})
	})

	describe('with an error', () => {
		beforeEach(() => {
			const cause = new Error('disk I/O error')

			logger.error('The job runner hit an error', { error: new Error('claim failed', { cause }) })
		})

		it('writes its name, message and cause', () => {
			expect(JSON.parse(writtenLine())).toMatchObject({
				error: { name: 'Error', message: 'claim failed', cause: { message: 'disk I/O error' } },
			})
		})
	})

	describe('with a field named like the head', () => {
		beforeEach(() => {
			logger.info('Started', { level: 'error', message: 'replaced' })
		})

		it('keeps its own level and message', () => {
			expect(JSON.parse(writtenLine())).toMatchObject({ level: 'info', message: 'Started' })
		})
	})
})
