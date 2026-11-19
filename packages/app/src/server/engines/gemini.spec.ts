// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { sleep } from 'bun'
import { afterEach, beforeEach, describe, expect, it, setSystemTime } from 'bun:test'
import { firstCardInput } from '#tests/factories/engine-input'
import badKey from '#tests/recordings/gemini/bad-key.json'
import explainCard from '#tests/recordings/gemini/explain-card.json'
import explainFacts from '#tests/recordings/gemini/explain-facts.json'
import quotaExceeded from '#tests/recordings/gemini/quota-exceeded.json'
import suggestAnswer from '#tests/recordings/gemini/suggest.json'
import unavailable from '#tests/recordings/gemini/unavailable.json'
import { createTestDb, type TestDb } from '#tests/setup/db'
import { errorOf } from '#tests/setup/engines'
import {
	fakeGeminiFetch,
	hang,
	recorded,
	recordedSuggestInput,
	suggestionSaying,
	type Answer,
	type SentRequest,
} from '#tests/setup/gemini'

import { engineRuns } from '#/server/db/schema/jobs'

import { EngineError, redactPrivate, type Engine, type EngineResult } from './contract'
import { createGeminiEngine, geminiSchema } from './gemini'
import { defaultEngines, type EngineSettings } from './settings'

const suggestInput = recordedSuggestInput()

const cardInput = redactPrivate(firstCardInput())

const fast = { tier: 'fast', timeoutMs: 10_000 } as const

const standard = { tier: 'standard', timeoutMs: 10_000 } as const

describe('gemini', () => {
	describe('geminiSchema', () => {
		it('leaves out $schema and keeps every other keyword', () => {
			const { $schema, ...rest } = cardInput.output.jsonSchema

			expect($schema).toBeDefined()
			expect(geminiSchema(cardInput.output.jsonSchema)).toEqual(rest)
		})
	})

	describe('createGeminiEngine', () => {
		let sent: SentRequest[]
		let answers: Answer[]
		let current: EngineSettings['gemini']
		let db: TestDb
		let engine: Engine

		function runRows() {
			return db.select().from(engineRuns).all()
		}

		beforeEach(async () => {
			sent = []
			answers = []
			current = { ...defaultEngines().gemini, apiKey: 'test-key-a' }
			;({ db } = await createTestDb())

			const fetch = fakeGeminiFetch(() => answers.shift(), sent)

			engine = createGeminiEngine({ db, settings: () => current, fetch })
		})

		afterEach(() => {
			setSystemTime()
		})

		describe('with the recorded suggestion', () => {
			let result: EngineResult<unknown>

			beforeEach(async () => {
				answers = [recorded(suggestAnswer)]
				result = await engine.suggest(suggestInput, fast)
			})

			it('returns the validated answer with the reported model', () => {
				expect(result).toMatchObject({
					output: { categories: ['english'], senses: [], language: 'en' },
					engine: 'gemini',
					model: 'gemini-3.1-flash-lite',
					searchSuggestions: null,
				})
			})

			it("sends one structured request without tools to the fast tier's model", () => {
				expect(sent).toMatchObject([
					{
						key: 'test-key-a',
						body: {
							generationConfig: {
								responseMimeType: 'application/json',
								responseJsonSchema: geminiSchema(suggestInput.output.jsonSchema),
								thinkingConfig: { thinkingLevel: 'MINIMAL' },
							},
						},
					},
				])
				expect(sent[0]?.url).toEndWith('/v1beta/models/gemini-3.1-flash-lite:generateContent')
				expect(sent[0]?.body).not.toHaveProperty('tools')
			})

			it('records one run with its usage', () => {
				expect(runRows()).toMatchObject([
					{
						engine: 'gemini',
						task: 'suggest',
						outcome: 'ok',
						model: 'gemini-3.1-flash-lite',
						inputTokens: 159,
						outputTokens: 26,
						searches: null,
					},
				])
			})
		})

		describe('with the recorded card', () => {
			let result: EngineResult<unknown>

			beforeEach(async () => {
				answers = [recorded(explainFacts), recorded(explainCard)]
				result = await engine.explain(cardInput, standard)
			})

			it('returns the card with the Search Suggestions to show with it', () => {
				expect(result).toMatchObject({
					output: { aliases: ['Wasm'] },
					model: 'gemini-2.5-flash',
				})
				expect(result.searchSuggestions).toContain('<style>')
			})

			it('asks for facts with search and the link, then for the card from them', () => {
				expect(sent).toMatchObject([
					{ body: { tools: [{ googleSearch: {} }, { urlContext: {} }] } },
					{ body: { generationConfig: { responseMimeType: 'application/json' } } },
				])
				expect(sent[0]?.body).not.toHaveProperty('generationConfig.responseMimeType')
				expect(sent[1]?.body).not.toHaveProperty('tools')
				expect(sent[1]?.text).toContain('- https://webassembly.org/: https://webassembly.org/')
				expect(sent[1]?.text).toContain('vertexaisearch.cloud.google.com/grounding-api-redirect')
			})

			it('records one run with both requests and the searches', () => {
				expect(runRows()).toMatchObject([
					{ task: 'explain', outcome: 'ok', inputTokens: 2040, outputTokens: 1451, searches: 1 },
				])
			})
		})

		describe('with a failure', () => {
			it.each([
				['the recorded quota 429', recorded(quotaExceeded), 'rate_limited'],
				['the recorded bad key', recorded(badKey), 'auth'],
				['an answer that is not JSON', suggestionSaying('Sure! Here it is'), 'invalid'],
				['an answer that breaks the format', suggestionSaying('{"categories":[]}'), 'invalid'],
				['an answer cut off', suggestionSaying('{"cate', 'MAX_TOKENS'), 'invalid'],
			])('reports %s as %s, with its run', async (_, answer, kind) => {
				answers = [answer]

				expect(await errorOf(engine.suggest(suggestInput, fast))).toMatchObject({ kind })
				expect(runRows()).toMatchObject([{ outcome: kind }])
			})

			it('reports the recorded 503 as an ordinary error with its body', async () => {
				answers = [recorded(unavailable)]

				const error = await errorOf(engine.suggest(suggestInput, fast))

				expect(error.constructor).toBe(Error)
				expect(error.message).toBe(`Gemini answered 503: ${JSON.stringify(unavailable.body)}`)
				expect(runRows()).toMatchObject([{ outcome: 'error' }])
			})

			it('ends a card whose second request hangs at the one deadline of the call', async () => {
				const facts = recorded(explainFacts)

				// The facts take 40 of the 60 ms, so a deadline per request would end the card near 100 ms.
				answers = [async (request) => sleep(40).then(async () => facts(request)), hang]

				const call = engine.explain(cardInput, { tier: 'standard', timeoutMs: 60 })

				expect(await errorOf(call)).toMatchObject({ failure: { kind: 'timeout', afterMs: 60 } })
				expect(sent).toHaveLength(2)
				expect(runRows()).toMatchObject([{ task: 'explain', outcome: 'timeout' }])
				expect(runRows()[0]?.durationMs).toBeLessThan(95)
			})

			it('stops at the timeout', async () => {
				answers = [hang]

				const error = await errorOf(engine.suggest(suggestInput, { tier: 'fast', timeoutMs: 20 }))

				expect(error).toMatchObject({ failure: { kind: 'timeout', afterMs: 20 } })
			})

			it("stops with the caller's reason when it aborts", async () => {
				const controller = new AbortController()
				const reason = new Error('Stopped by the caller')

				answers = [hang]

				const call = errorOf(engine.suggest(suggestInput, { ...fast, signal: controller.signal }))

				setTimeout(() => {
					controller.abort(reason)
				}, 5)

				expect(await call).toBe(reason)
			})

			it('fails without a key, sending nothing', async () => {
				current = { ...current, apiKey: null }

				expect(await errorOf(engine.suggest(suggestInput, fast))).toMatchObject({
					message: 'The Gemini engine has no key',
				})
				expect(sent).toHaveLength(0)
			})
		})

		describe('with configured limits', () => {
			beforeEach(() => {
				setSystemTime(new Date('2026-11-19T15:00:00Z'))
			})

			it('refuses the call past the daily limit before sending it', async () => {
				const fastLimit = { perMinute: null, perDay: 1 }

				current = { ...current, limits: { ...current.limits, fast: fastLimit } }
				answers = [recorded(suggestAnswer), recorded(suggestAnswer)]
				await engine.suggest(suggestInput, fast)

				expect(await errorOf(engine.suggest(suggestInput, fast))).toMatchObject({
					failure: { kind: 'rate_limited', resetsAt: new Date('2026-11-20T08:00:00Z') },
				})
				expect(sent).toHaveLength(1)
				expect(runRows()).toMatchObject([{ outcome: 'ok' }, { outcome: 'rate_limited' }])
			})

			it('refuses a card whose two requests do not both fit, before sending either', async () => {
				const limit = { perMinute: 2, perDay: null }

				current = { ...current, limits: { fast: limit, standard: limit, deep: limit } }
				current = { ...current, models: { ...current.models, standard: current.models.fast } }
				answers = [recorded(suggestAnswer)]
				await engine.suggest(suggestInput, fast)

				expect(await errorOf(engine.explain(cardInput, standard))).toMatchObject({
					failure: { kind: 'rate_limited', resetsAt: new Date('2026-11-19T15:01:00Z') },
				})
				expect(sent).toHaveLength(1)
			})

			it('fails a card with an ordinary error when its limit is below two requests', async () => {
				current = {
					...current,
					limits: { ...current.limits, standard: { perMinute: 1, perDay: null } },
				}

				const error = await errorOf(engine.explain(cardInput, standard))

				expect(error).not.toBeInstanceOf(EngineError)
				expect(runRows()).toMatchObject([{ outcome: 'error' }])
				expect(sent).toHaveLength(0)
			})
		})
	})
})
