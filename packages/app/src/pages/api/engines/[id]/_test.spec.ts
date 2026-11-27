// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test'
import { faker } from '@faker-js/faker'
import { configuredSettingsFactory } from '#tests/factories/settings'
import { sendThroughMiddleware, signedInInstance } from '#tests/setup/auth'
import { createTestDb } from '#tests/setup/db'
import { fakeEngine, type Reply } from '#tests/setup/fake-engine'
import * as v from 'valibot'

import * as instanceEngines from '#/instance-engines'
import { EngineError, type Engine, type EngineFailure } from '#/server/engines/contract'
import { createEngineTester } from '#/server/engines/probe'
import { defaultRouting } from '#/server/engines/settings'
import { log } from '#/server/log'

import { POST } from './test'

const publicOrigin = 'http://127.0.0.1:4321'

const suggestion = { categories: ['1'], senses: [], language: 'en' }

const resetsAt = new Date('2026-11-20T11:00:00.000Z')

const okResult = v.strictObject({
	engine: v.literal('gemini'),
	testedAt: v.pipe(v.string(), v.isoTimestamp()),
	outcome: v.literal('ok'),
	elapsedMs: v.number(),
	model: v.nullable(v.string()),
})

const isoTimestamp = v.pipe(v.string(), v.isoTimestamp())

// Exactly these fields, so a message, a provider body or a URL cannot slip in.
const failedResult = v.strictObject({
	engine: v.literal('gemini'),
	testedAt: v.pipe(v.string(), v.isoTimestamp()),
	outcome: v.picklist(['rate_limited', 'auth', 'timeout', 'invalid', 'error']),
	resetsAt: v.optional(isoTimestamp),
})

type Sender = 'owner' | 'device' | 'nobody' | 'another site'

describe('POST /api/engines/:id/test', () => {
	let reply: Reply
	let before: () => Promise<void>
	let send: (id: string, as?: Sender) => Promise<Response>

	beforeEach(async () => {
		const { db } = await createTestDb()
		const { auth, session } = signedInInstance(db, publicOrigin)

		reply = { delayMs: 0, answer: suggestion }
		before = async () => {
			// Answers at once.
		}

		const scripted = fakeEngine({ clock: { ms: 0 }, received: [], reply: () => reply })

		const gemini: Engine = {
			...scripted,
			async suggest(input, options) {
				await before()

				return scripted.suggest(input, options)
			},
		}

		const tester = createEngineTester({
			engines: { 'agent-command': null, gemini, 'openai-compatible': scripted },
			settings: () => ({
				engines: configuredSettingsFactory.build().engines,
				routing: defaultRouting(),
			}),
			agentCommand: null,
		})

		spyOn(instanceEngines, 'instanceEngineTester').mockResolvedValue(tester)
		spyOn(log, 'warn').mockImplementation(() => {
			// Kept out of the test output.
		})

		send = async (id, as = 'owner') => {
			const headers = new Headers()

			if (as === 'device') {
				headers.set('authorization', `Bearer ${auth.devices.create('Shortcut').token}`)
			} else if (as === 'another site') {
				headers.set('sec-fetch-site', 'cross-site')
			} else if (as === 'owner') {
				headers.set('origin', publicOrigin)
			}

			const request = new Request(`${publicOrigin}/api/engines/${id}/test`, {
				method: 'POST',
				headers,
			})

			const cookies = as === 'owner' || as === 'another site' ? session : undefined

			return sendThroughMiddleware(
				{ auth, publicOrigin },
				{ request, cookies, params: { id } },
				POST,
			)
		}
	})

	afterEach(() => {
		mock.restore()
	})

	it('answers a working engine with its outcome, time and model, not to be cached', async () => {
		const response = await send('gemini')

		expect([
			response.status,
			response.headers.get('cache-control'),
			v.is(okResult, await response.json()),
		]).toEqual([200, 'no-store', true])
	})

	it.each([
		[{ kind: 'auth' }, { outcome: 'auth' }],
		[{ kind: 'timeout', afterMs: 15_000 }, { outcome: 'timeout' }],
		[{ kind: 'invalid', issues: ['categories: Invalid'] }, { outcome: 'invalid' }],
		[
			{ kind: 'rate_limited', resetsAt },
			{ outcome: 'rate_limited', resetsAt: resetsAt.toISOString() },
		],
	] satisfies [EngineFailure, object][])(
		'answers 200 with the outcome of a %o failure and no message',
		async (failure, outcome) => {
			reply = { delayMs: 0, answer: new EngineError(failure, faker.lorem.sentence()) }

			const response = await send('gemini')

			expect([response.status, v.parse(failedResult, await response.json())]).toMatchObject([
				200,
				outcome,
			])
		},
	)

	it('answers error for a failure that quotes a key, without the key', async () => {
		const key = `sk-${faker.string.alphanumeric(40)}`

		before = async () => {
			throw new Error(`Refused ${key}`)
		}

		const response = await send('gemini')
		const text = await response.text()

		expect([
			response.status,
			v.parse(failedResult, JSON.parse(text)).outcome,
			text.includes(key),
		]).toEqual([200, 'error', false])
	})

	it.each([
		['local', 404, 'not_found'],
		['agent-command', 409, 'not_set_up'],
	] as const)('refuses a test of %s', async (id, status, code) => {
		const response = await send(id)

		expect([response.status, await response.json()]).toMatchObject([status, { error: { code } }])
	})

	it('refuses a second test while one runs', async () => {
		const { promise, resolve } = Promise.withResolvers<null>()

		before = async () => {
			await promise
		}

		const first = send('gemini')
		const second = await send('gemini')

		resolve(null)
		await first

		expect([second.status, await second.json()]).toMatchObject([
			409,
			{ error: { code: 'test_running' } },
		])
	})

	it('refuses a test within 10 s of the last, saying when to try again', async () => {
		await send('gemini')

		const response = await send('gemini')

		expect([
			response.status,
			response.headers.get('retry-after'),
			await response.json(),
		]).toMatchObject([429, '10', { error: { code: 'too_soon' } }])
	})

	it.each([
		['device', 403, 'session_required'],
		['nobody', 401, 'unauthorized'],
		['another site', 403, 'cross_site'],
	] as const)('refuses a request from %s', async (as, status, code) => {
		const response = await send('gemini', as)

		expect([response.status, await response.json()]).toMatchObject([status, { error: { code } }])
	})
})
