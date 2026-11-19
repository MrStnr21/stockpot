// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { $, serve, write } from 'bun'
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createTestDb } from '#tests/setup/db'
import { errorOf } from '#tests/setup/engines'
import { fakeGeminiFetch, suggestionSaying, type SentRequest } from '#tests/setup/gemini'

import { redactPrivate } from '#/server/engines/contract'
import { suggestionFormat } from '#/server/engines/suggestion'

import { createEvalEngine, type EvalEngine } from './engines'

const answer = { categories: ['brief'], senses: [], language: 'en' }

const options = { tier: 'fast', timeoutMs: 20_000 } as const

function privateSuggestion() {
	return redactPrivate({
		task: 'suggest',
		note: {
			term: 'ferritin',
			text: 'Ferritin',
			context: 'a lab report',
			url: null,
			isPrivate: true,
		},
		language: 'en',
		output: suggestionFormat(['brief']),
		categories: [{ id: 'brief', name: 'Other', hint: null }],
	})
}

const completion = {
	id: 'completion',
	object: 'chat.completion',
	created: 0,
	model: 'model',
	choices: [
		{
			index: 0,
			message: { role: 'assistant', content: JSON.stringify(answer), refusal: null },
			finish_reason: 'stop',
		},
	],
	usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
}

describe('eval engines', () => {
	describe('the agent command', () => {
		const folder = join(tmpdir(), `stockpot-eval-engines-${crypto.randomUUID()}`)
		const agent = join(folder, 'agent.ts')
		let evalEngine: EvalEngine

		beforeAll(async () => {
			const printAnswer = `console.log(${JSON.stringify(JSON.stringify(answer))})`

			await write(agent, `await Bun.stdin.text()\n${printAnswer}\n`)

			const { db } = await createTestDb()
			const env = { STOCKPOT_AGENT_COMMAND: `'${process.execPath}' '${agent}'` }

			evalEngine = await createEvalEngine('agent-command', { env, db })
		})

		afterAll(async () => {
			await evalEngine.close()
			await $`rm -rf ${folder}`
		})

		it('records the prompt the agent received, and still answers', async () => {
			const result = await evalEngine.engine.suggest(privateSuggestion(), options)
			const payloads = await evalEngine.outgoing?.take()

			expect(result.output).toEqual(answer)
			expect(payloads?.length).toBe(1)
			expect(payloads?.at(0)).toContain('ferritin')
			expect(payloads?.at(0)).not.toContain('a lab report')
		})

		it('refuses a model override, since its script picks the models', async () => {
			const { db } = await createTestDb()
			const env = { STOCKPOT_AGENT_COMMAND: 'agent' }
			const models = { fast: 'model' }

			const error = await errorOf(createEvalEngine('agent-command', { env, db, models }))

			expect(error.message).toContain('The agent command picks the model for each tier itself')
		})
	})

	describe('the OpenAI-compatible engine', () => {
		const received: string[] = []

		const upstream = serve({
			hostname: '127.0.0.1',
			port: 0,
			fetch: async (request) => {
				received.push(await request.text())

				return Response.json(completion)
			},
		})

		const env = {
			STOCKPOT_EVAL_OPENAI_BASE_URL: `http://127.0.0.1:${upstream.port}/v1`,
			STOCKPOT_EVAL_OPENAI_MODEL: 'model',
		}

		let evalEngine: EvalEngine

		beforeAll(async () => {
			const { db } = await createTestDb()

			evalEngine = await createEvalEngine('openai-compatible', { env, db })
		})

		afterAll(async () => {
			await evalEngine.close()
			await upstream.stop(true)
		})

		it('records the request body it forwards upstream', async () => {
			const result = await evalEngine.engine.suggest(privateSuggestion(), options)
			const payloads = await evalEngine.outgoing?.take()

			expect(result.output).toEqual(answer)
			expect(payloads).toEqual(received)
			expect(payloads?.at(0)).toContain('ferritin')
		})

		it('serves every tier with one model unless the run overrides a tier', async () => {
			const { db } = await createTestDb()
			const models = { deep: 'larger-model' }
			const overridden = await createEvalEngine('openai-compatible', { env, db, models })

			await overridden.close()

			expect(overridden.models).toEqual({ fast: 'model', standard: 'model', deep: 'larger-model' })
		})
	})

	describe('the Gemini engine', () => {
		const sent: SentRequest[] = []
		let evalEngine: EvalEngine

		beforeAll(async () => {
			const { db } = await createTestDb()
			const fetch = fakeGeminiFetch(() => suggestionSaying(JSON.stringify(answer)), sent)
			const env = { GEMINI_API_KEY: 'test-key' }

			evalEngine = await createEvalEngine('gemini', { env, db, fetch })
		})

		afterAll(async () => {
			await evalEngine.close()
		})

		it('records the request body the SDK sends', async () => {
			const result = await evalEngine.engine.suggest(privateSuggestion(), options)
			const payloads = await evalEngine.outgoing?.take()

			expect(result.output).toEqual(answer)
			expect(payloads).toEqual(sent.map(({ text }) => text))
			expect(payloads?.at(0)).toContain('ferritin')
			expect(payloads?.at(0)).not.toContain('a lab report')
		})

		describe('with tier models from the environment and the run', () => {
			const overriddenSent: SentRequest[] = []
			let overridden: EvalEngine

			beforeAll(async () => {
				const { db } = await createTestDb()

				const fetch = fakeGeminiFetch(
					() => suggestionSaying(JSON.stringify(answer)),
					overriddenSent,
				)

				const env = {
					GEMINI_API_KEY: 'test-key',
					STOCKPOT_EVAL_GEMINI_FAST: 'gemini-2.5-flash',
					STOCKPOT_EVAL_GEMINI_DEEP: 'gemini-2.5-flash',
				}

				const models = { fast: 'gemini-2.5-flash-lite' }

				overridden = await createEvalEngine('gemini', { env, db, fetch, models })
			})

			it('takes the run over the environment, and the environment over the defaults', () => {
				expect(overridden.models).toEqual({
					fast: 'gemini-2.5-flash-lite',
					standard: 'gemini-2.5-flash',
					deep: 'gemini-2.5-flash',
				})
			})

			it("sends a suggestion to the fast tier's model, with thinking off", async () => {
				await overridden.engine.suggest(privateSuggestion(), options)

				expect(overriddenSent.at(0)?.url).toEndWith('/models/gemini-2.5-flash-lite:generateContent')
				expect(overriddenSent.at(0)?.body).toMatchObject({
					generationConfig: { thinkingConfig: { thinkingBudget: 0 } },
				})
			})
		})
	})
})
