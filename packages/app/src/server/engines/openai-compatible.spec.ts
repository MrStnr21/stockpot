// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { serve } from 'bun'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, jest } from 'bun:test'
import { cardInputFactory, suggestInputFactory } from '#tests/factories/engine-input'
import { createTestDb, type TestDb } from '#tests/setup/db'

import { engineRuns } from '#/server/db/schema/jobs'

import {
	EngineError,
	parseJsonText,
	redactPrivate,
	type Engine,
	type EngineResult,
	type JsonValue,
} from './contract'
import { createOpenAiCompatibleEngine } from './openai-compatible'
import type { EngineSettings } from './settings'

type Settings = EngineSettings['openai-compatible']

interface Received {
	readonly path: string
	readonly authorization: string | null
	readonly body: JsonValue
}

const answer = { categories: ['technology'], senses: [], language: 'en' }

const options = { tier: 'standard', timeoutMs: 10_000 } as const

const rejected = /"(?:\$schema|minLength|maxLength)"|"format":"uri"/u

function completion(content: string) {
	return Response.json({
		model: 'model-a-2026',
		choices: [{ message: { role: 'assistant', content } }],
		usage: { prompt_tokens: 900, completion_tokens: 120 },
	})
}

/** The error a call failed with; fails the test when the call succeeds. */
async function errorOf<T>(call: Promise<T>): Promise<Error> {
	try {
		await call
	} catch (error) {
		if (error instanceof Error) {
			return error
		}

		throw error
	}

	throw new Error('Expected the call to fail')
}

describe('createOpenAiCompatibleEngine', () => {
	const input = redactPrivate(suggestInputFactory.build())
	let server: ReturnType<typeof serve>
	let requests: Received[]
	let respond: (request: Request) => Promise<Response>
	let held: PromiseWithResolvers<null>
	let current: Settings
	let db: TestDb
	let engine: Engine

	function settingsAt(path: string, apiKey: string | null, model: string): Settings {
		const baseUrl = new URL(path, server.url).href

		return { baseUrl, apiKey, models: { fast: model, standard: model, deep: model } }
	}

	function runRows() {
		return db.select().from(engineRuns).all()
	}

	beforeAll(() => {
		server = serve({
			port: 0,
			async fetch(request) {
				const path = new URL(request.url).pathname

				if (path === '/ping') {
					return new Response('pong')
				}

				requests.push({
					path,
					authorization: request.headers.get('authorization'),
					body: parseJsonText(await request.text()),
				})

				return respond(request)
			},
		})
	})

	beforeEach(async () => {
		requests = []
		held = Promise.withResolvers<null>()
		respond = async () => completion(JSON.stringify(answer))
		current = settingsAt('/a/v1', 'test-key-a', 'model-a')
		;({ db } = await createTestDb())
		engine = createOpenAiCompatibleEngine({ db, settings: () => current })
	})

	afterEach(() => {
		jest.useRealTimers()
		held.resolve(null)
	})

	afterAll(async () => {
		await server.stop(true)
	})

	describe('with a good answer', () => {
		let result: EngineResult<unknown>

		beforeEach(async () => {
			result = await engine.suggest(input, options)
		})

		it('returns the validated answer with the reported model', () => {
			expect(result).toMatchObject({
				output: answer,
				engine: 'openai-compatible',
				model: 'model-a-2026',
			})
		})

		it("posts the prompt, the tier's model, a strict schema and the key", () => {
			expect(requests).toMatchObject([
				{ path: '/a/v1/chat/completions', authorization: 'Bearer test-key-a' },
			])
			expect(requests[0]?.body).toMatchObject({
				model: 'model-a',
				messages: [{ role: 'user' }],
				response_format: { type: 'json_schema', json_schema: { name: 'suggestion', strict: true } },
			})
			expect(JSON.stringify(requests[0]?.body)).toContain(`Term: ${input.note.term}`)
		})

		it('records the run with its usage', () => {
			expect(runRows()).toMatchObject([
				{
					engine: 'openai-compatible',
					task: 'suggest',
					outcome: 'ok',
					model: 'model-a-2026',
					inputTokens: 900,
					outputTokens: 120,
				},
			])
		})
	})

	describe('with a card', () => {
		beforeEach(async () => {
			respond = async () => new Response('down', { status: 500 })
			const card = redactPrivate(cardInputFactory.build())

			await errorOf(engine.explain(card, options))
		})

		it('never sends the keywords strict mode rejects', () => {
			expect(JSON.stringify(requests[0]?.body)).not.toMatch(rejected)
		})

		it('writes from text only, without sources', () => {
			expect(JSON.stringify(requests[0]?.body)).toContain('leave every list of sources empty')
		})
	})

	it.each([
		['retry-after', '30', '2026-11-19T12:00:30Z'],
		['retry-after', 'Thu, 19 Nov 2026 12:05:00 GMT', '2026-11-19T12:05:00Z'],
		['x-ratelimit-reset-requests', '1m30s', '2026-11-19T12:01:30Z'],
		['x-unrelated', '1', '2026-11-19T12:01:00Z'],
	])('maps a 429 with %s: %s to rate_limited until %s', async (header, value, resetsAt) => {
		jest.useFakeTimers({ now: new Date('2026-11-19T12:00:00Z') })
		respond = async () => new Response('slow down', { status: 429, headers: { [header]: value } })

		const error = await errorOf(engine.suggest(input, options))

		expect(error).toBeInstanceOf(EngineError)
		expect(error).toMatchObject({ failure: { kind: 'rate_limited', resetsAt: new Date(resetsAt) } })
		expect(runRows()).toMatchObject([{ outcome: 'rate_limited' }])
	})

	it.each([401, 403])('maps %d to auth', async (status) => {
		respond = async () => new Response('no', { status })

		const error = await errorOf(engine.suggest(input, options))

		expect(error).toMatchObject({ failure: { kind: 'auth' } })
		expect(runRows()).toMatchObject([{ outcome: 'auth' }])
	})

	it('fails an answer that is not JSON with invalid', async () => {
		respond = async () => completion('Sure! Here are the categories.')

		const error = await errorOf(engine.suggest(input, options))

		expect(error).toMatchObject({
			failure: { kind: 'invalid', issues: ['The answer is not JSON'] },
		})
	})

	it('fails a server error with an ordinary error', async () => {
		respond = async () => new Response('down for maintenance', { status: 503 })

		const error = await errorOf(engine.suggest(input, options))

		expect(error).not.toBeInstanceOf(EngineError)
		expect(error.message).toContain('503: down for maintenance')
		expect(runRows()).toMatchObject([{ outcome: 'error' }])
	})

	describe('with an endpoint that does not answer', () => {
		let received: PromiseWithResolvers<null>

		beforeEach(() => {
			received = Promise.withResolvers<null>()
			respond = async () => {
				received.resolve(null)
				await held.promise

				return completion(JSON.stringify(answer))
			}
		})

		it('fails with timeout at the timeout', async () => {
			jest.useFakeTimers()

			const call = engine.suggest(input, { tier: 'fast', timeoutMs: 3000 })

			await received.promise
			jest.advanceTimersByTime(3000)

			expect(await errorOf(call)).toMatchObject({ failure: { kind: 'timeout', afterMs: 3000 } })
			expect(runRows()).toMatchObject([{ outcome: 'timeout' }])
		})

		it('fails with the abort reason when aborted', async () => {
			const reason = new Error('The runner stopped')
			const controller = new AbortController()
			const call = engine.suggest(input, { ...options, signal: controller.signal })

			await received.promise
			controller.abort(reason)

			expect(await errorOf(call)).toBe(reason)
		})

		it('sends one request at a time', async () => {
			const calls = Promise.all([engine.suggest(input, options), engine.suggest(input, options)])

			await received.promise
			// A round trip to the server, in which a second request sent at once would have arrived.
			await fetch(new URL('/ping', server.url))

			expect(requests).toHaveLength(1)

			held.resolve(null)
			await calls

			expect(requests).toHaveLength(2)
		})
	})

	describe('when the settings change between calls', () => {
		beforeEach(async () => {
			await engine.suggest(input, options)
			current = settingsAt('/b/v1', null, 'model-b')
			await engine.suggest(input, options)
		})

		it('sends the next call to the new endpoint, model and key', () => {
			expect(requests).toMatchObject([
				{ path: '/a/v1/chat/completions', authorization: 'Bearer test-key-a' },
				{ path: '/b/v1/chat/completions', authorization: null },
			])
			expect(requests[1]?.body).toMatchObject({ model: 'model-b' })
		})
	})
})
