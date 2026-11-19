// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { $, serve, write } from 'bun'
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createTestDb } from '#tests/setup/db'
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

		let evalEngine: EvalEngine

		beforeAll(async () => {
			const { db } = await createTestDb()

			const env = {
				STOCKPOT_EVAL_OPENAI_BASE_URL: `http://127.0.0.1:${upstream.port}/v1`,
				STOCKPOT_EVAL_OPENAI_MODEL: 'model',
			}

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
	})
})
