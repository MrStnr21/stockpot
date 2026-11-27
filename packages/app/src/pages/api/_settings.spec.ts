// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test'
import { faker } from '@faker-js/faker'
import { configuredSettingsFactory } from '#tests/factories/settings'
import { sendThroughMiddleware, signedInInstance, type RouteHandler } from '#tests/setup/auth'
import { createTestDb, type TestDb } from '#tests/setup/db'
import * as v from 'valibot'

import { readSettings, updateSettings } from '#/features/settings/server'
import * as instance from '#/server/db/instance'
import type { JsonValue } from '#/server/engines/contract'
import * as jobsRunner from '#/server/jobs/runner'
import type { Runner } from '#/server/jobs/types'

import { GET, PATCH } from './settings'

const publicOrigin = 'http://127.0.0.1:4321'

const secretState = v.picklist(['set', 'not set'])

const answerSchema = v.object({
	digest: v.object({ limit: v.number(), timeZone: v.string() }),
	engines: v.object({
		'agent-command': v.strictObject({ command: secretState }),
		gemini: v.object({ apiKey: secretState }),
		'openai-compatible': v.object({ apiKey: secretState }),
	}),
})

interface Sent {
	readonly handler: RouteHandler
	readonly method: 'GET' | 'PATCH'
	readonly body?: JsonValue
	readonly as?: 'owner' | 'device' | 'nobody' | 'another site'
}

/** A PATCH from the web app with this body. */
function patch(body: JsonValue): Sent {
	return { handler: PATCH, method: 'PATCH', body }
}

describe('/api/settings', () => {
	let db: TestDb
	let send: (sent: Sent) => Promise<Response>
	let refreshSchedules: ReturnType<typeof spyOn<Runner, 'refreshSchedules'>>

	beforeEach(async () => {
		;({ db } = await createTestDb())
		spyOn(instance, 'instanceDb').mockResolvedValue(db)

		const runner = jobsRunner.createRunner({ db })

		refreshSchedules = spyOn(runner, 'refreshSchedules')
		spyOn(jobsRunner, 'currentRunner').mockReturnValue(runner)

		const { auth, session } = signedInInstance(db, publicOrigin)

		send = async ({ handler, method, body, as = 'owner' }) => {
			const headers = new Headers({ 'content-type': 'application/json' })

			if (as === 'device') {
				headers.set('authorization', `Bearer ${auth.devices.create('Shortcut').token}`)
			} else if (as === 'another site') {
				headers.set('sec-fetch-site', 'cross-site')
			} else if (as === 'owner') {
				headers.set('origin', publicOrigin)
			}

			const request = new Request(`${publicOrigin}/api/settings`, {
				method,
				headers,
				body: body === undefined ? undefined : JSON.stringify(body),
			})

			const cookies = as === 'owner' || as === 'another site' ? session : undefined

			return sendThroughMiddleware({ auth, publicOrigin }, { request, cookies }, handler)
		}
	})

	afterEach(() => {
		mock.restore()
	})

	describe.each([
		['GET', GET, undefined],
		['PATCH', PATCH, { digest: { limit: 7 } }],
	] as const)('%s', (method, handler, body) => {
		it.each([
			['device', 403, 'session_required'],
			['nobody', 401, 'unauthorized'],
		] as const)('refuses a request from %s', async (as, status, code) => {
			const response = await send({ handler, method, body, as })

			expect([response.status, await response.json()]).toMatchObject([status, { error: { code } }])
		})

		it('answers the owner with the settings, not to be cached', async () => {
			const response = await send({ handler, method, body })

			expect([
				response.status,
				response.headers.get('cache-control'),
				v.is(answerSchema, await response.json()),
			]).toEqual([200, 'no-store', true])
		})
	})

	it('GET never answers with a stored key', async () => {
		const configured = configuredSettingsFactory.build()

		updateSettings(db, configured)

		const response = await send({ handler: GET, method: 'GET' })
		const text = await response.text()

		expect([
			text.includes(configured.engines.gemini.apiKey ?? 'no key'),
			text.includes(configured.engines['openai-compatible'].apiKey ?? 'no key'),
		]).toEqual([false, false])
	})

	describe('PATCH', () => {
		it('refuses another site before the change', async () => {
			const response = await send({
				handler: PATCH,
				method: 'PATCH',
				body: { digest: { limit: 7 } },
				as: 'another site',
			})

			expect([response.status, readSettings(db).digest.limit]).toEqual([403, 5])
		})

		it('answers with the change applied', async () => {
			const response = await send(
				patch({
					digest: { timeZone: 'europe/berlin', limit: 9 },
				}),
			)

			expect(await response.json()).toMatchObject({
				digest: { timeZone: 'Europe/Berlin', limit: 9 },
			})
		})

		describe('with a key', () => {
			let key: string
			let response: Response
			let text: string

			beforeEach(async () => {
				key = faker.string.alphanumeric(48)
				response = await send(patch({ engines: { 'openai-compatible': { apiKey: key } } }))
				text = await response.text()
			})

			it('stores it and shows it as set', () => {
				expect([
					readSettings(db).engines['openai-compatible'].apiKey,
					v.parse(answerSchema, JSON.parse(text)).engines['openai-compatible'].apiKey,
				]).toEqual([key, 'set'])
			})

			it('never answers with it', () => {
				expect(text.includes(key)).toBe(false)
			})

			it('clears it with null', async () => {
				const cleared = await send(
					patch({
						engines: { 'openai-compatible': { apiKey: null } },
					}),
				)

				expect(v.parse(answerSchema, await cleared.json()).engines['openai-compatible']).toEqual({
					apiKey: 'not set',
				})
			})
		})

		it('refuses a key of 4,097 characters without quoting it', async () => {
			const key = faker.string.alphanumeric(4097)
			const response = await send(patch({ engines: { gemini: { apiKey: key } } }))
			const text = await response.text()

			expect([response.status, text.includes(key), text.includes(key.slice(0, 16))]).toEqual([
				400,
				false,
				false,
			])
		})

		it.each([
			['an empty body', {}],
			['Gemini limits', { engines: { gemini: { limits: {} } } }],
			['per-category routes', { routing: { fallbackOrder: ['gemini'], categories: {} } }],
		])('refuses %s', async (_name, change) => {
			const response = await send(patch(change))

			expect([response.status, await response.json()]).toMatchObject([
				400,
				{ error: { code: 'invalid_body' } },
			])
		})

		it.each([
			['the night run time', { batchTime: '05:45' }, 1],
			['the time zone', { timeZone: 'Asia/Tokyo' }, 1],
			['the digest time', { time: '07:00' }, 0],
			['the card limit', { limit: 6 }, 0],
		])('plans the schedules again after a change to %s: %p times', async (_name, digest, times) => {
			await send(patch({ digest }))

			expect(refreshSchedules).toHaveBeenCalledTimes(times)
		})
	})
})
