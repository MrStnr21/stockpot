// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { describe, expect, it } from 'bun:test'
import * as v from 'valibot'

import { pushPayload, pushPayloadSchema } from './payload'

const origin = 'https://stockpot.example.ts.net'

const message = {
	title: 'Ready: Kafka',
	body: 'Technology · tap to read',
	path: '/notes/12',
	tag: 'ready-12',
}

describe('pushPayload', () => {
	it('writes a declarative push that opens the path on the instance', () => {
		expect(pushPayload(message, { origin, lang: 'en' })).toEqual({
			web_push: 8030,
			notification: {
				title: 'Ready: Kafka',
				body: 'Technology · tap to read',
				navigate: 'https://stockpot.example.ts.net/notes/12',
				tag: 'ready-12',
				lang: 'en',
			},
		})
	})

	it('reads back with the schema the worker uses', () => {
		const text = JSON.stringify(pushPayload(message, { origin, lang: 'ru' }))
		const payload: unknown = JSON.parse(text)

		expect(v.parse(pushPayloadSchema, payload)).toEqual(
			pushPayload(message, { origin, lang: 'ru' }),
		)
	})

	describe('the schema', () => {
		const { notification } = pushPayload(message, { origin, lang: 'en' })

		it.each([
			['a missing title', { web_push: 8030, notification: { ...notification, title: undefined } }],
			['an empty title', { web_push: 8030, notification: { ...notification, title: '' } }],
			['another format', { web_push: 1, notification }],
			['a path for navigate', { web_push: 8030, notification: { ...notification, navigate: '/' } }],
		])('refuses %s', (_name, payload) => {
			expect(v.safeParse(pushPayloadSchema, payload).success).toBe(false)
		})
	})
})
