// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test'
import { faker } from '@faker-js/faker'
import { agentCommand, configuredSettingsFactory } from '#tests/factories/settings'
import type * as v from 'valibot'

import { log } from '#/server/log'

import {
	EngineError,
	parseOutput,
	type Engine,
	type EngineFailure,
	type EngineInput,
	type OutputFormat,
	type Redacted,
	type RunOptions,
} from './contract'
import {
	createEngineTester,
	engineTestCooldownMs,
	type EngineTestAnswer,
	type EngineTester,
} from './probe'
import type { EngineSet } from './router'
import { defaultEngines, defaultRouting } from './settings'

const startedAt = new Date('2026-11-20T10:00:00.000Z')

const resetsAt = new Date('2026-11-20T11:00:00.000Z')

interface Received {
	readonly input: Redacted<EngineInput>
	readonly options: RunOptions
}

/** An engine that records each call and answers with `answer`, which a test replaces. */
function scriptedEngine() {
	const received: Received[] = []

	const state = {
		received,
		answer: async (): Promise<void> => {
			// Answers at once.
		},
	}

	async function run<TSchema extends v.GenericSchema>(
		input: Redacted<EngineInput & { readonly output: OutputFormat<TSchema> }>,
		options: RunOptions,
	) {
		state.received.push({ input, options })
		await state.answer()

		const output = parseOutput(input.output, {
			categories: ['1'],
			senses: [],
			language: 'en',
		})

		return {
			output,
			engine: 'gemini',
			model: 'model-fast',
			searchSuggestions: null,
			elapsedMs: 840,
		}
	}

	const engine: Engine = { id: 'gemini', suggest: run, explain: run, research: run }

	return { engine, state }
}

describe('createEngineTester', () => {
	let clock: Date
	let gemini: ReturnType<typeof scriptedEngine>
	let tester: EngineTester
	let warn: ReturnType<typeof spyOn<typeof log, 'warn'>>

	beforeEach(() => {
		clock = startedAt
		gemini = scriptedEngine()
		warn = spyOn(log, 'warn').mockImplementation(() => {
			// Kept out of the test output.
		})

		const engines: EngineSet = {
			'agent-command': null,
			gemini: gemini.engine,
			'openai-compatible': null,
		}

		const { engines: configured } = configuredSettingsFactory.build()

		tester = createEngineTester({
			engines,
			settings: () => ({ engines: configured, routing: defaultRouting() }),
			agentCommand: null,
			now: () => clock,
		})
	})

	afterEach(() => {
		mock.restore()
	})

	function after(ms: number) {
		clock = new Date(startedAt.getTime() + ms)
	}

	function failWith(error: Error) {
		gemini.state.answer = async () => {
			throw error
		}
	}

	it('sends one fast suggestion on a fixed note, with no owner data and no job', async () => {
		await tester.test('gemini')

		const calls = gemini.state.received.map(({ input, options }) => ({
			note: input.note,
			categories: input.task === 'suggest' ? input.categories : null,
			language: input.language,
			output: input.output.id,
			options,
		}))

		expect(calls).toEqual([
			{
				note: { term: 'TypeScript', text: null, context: null, url: null, isPrivate: false },
				categories: [{ id: '1', name: 'Technology', hint: null }],
				language: 'en',
				output: 'suggestion',
				options: { tier: 'fast', timeoutMs: 15_000 },
			},
		])
	})

	it('answers a working engine with its time and model', async () => {
		expect(await tester.test('gemini')).toEqual({
			status: 'done',
			result: {
				engine: 'gemini',
				testedAt: startedAt.toISOString(),
				outcome: 'ok',
				elapsedMs: 840,
				model: 'model-fast',
			},
		})
	})

	it.each([
		[{ kind: 'auth' }, { outcome: 'auth' }],
		[{ kind: 'timeout', afterMs: 15_000 }, { outcome: 'timeout' }],
		[{ kind: 'invalid', issues: ['categories: Invalid type'] }, { outcome: 'invalid' }],
		[
			{ kind: 'rate_limited', resetsAt },
			{ outcome: 'rate_limited', resetsAt: resetsAt.toISOString() },
		],
	] satisfies [EngineFailure, object][])(
		'reduces a %o failure to its outcome',
		async (failure, outcome) => {
			failWith(new EngineError(failure, faker.lorem.sentence()))

			// Widened, so the expected outcome can come from the table.
			const answer: object = await tester.test('gemini')

			expect(answer).toEqual({
				status: 'done',
				result: { engine: 'gemini', testedAt: startedAt.toISOString(), ...outcome },
			})
		},
	)

	describe('when the engine throws an error that quotes a key', () => {
		let key: string
		let answer: EngineTestAnswer

		beforeEach(async () => {
			key = `sk-${faker.string.alphanumeric(40)}`
			failWith(new Error(`The request with ${key} was refused`))
			answer = await tester.test('gemini')
		})

		it('answers error', () => {
			expect(answer).toMatchObject({ status: 'done', result: { outcome: 'error' } })
		})

		it('keeps the key out of the answer and the log', () => {
			expect(JSON.stringify([answer, warn.mock.calls])).not.toContain(key)
		})

		it('logs the engine, the outcome and the error name', () => {
			expect(warn.mock.calls).toEqual([
				['Engine test failed', { engine: 'gemini', outcome: 'error', error: 'Error' }],
			])
		})
	})

	it('refuses a second test while one runs', async () => {
		const { promise: answered, resolve } = Promise.withResolvers<null>()

		gemini.state.answer = async () => {
			await answered
		}

		const first = tester.test('gemini')
		const second = await tester.test('gemini')

		resolve(null)
		await first

		expect([second, gemini.state.received.length]).toEqual([{ status: 'running' }, 1])
	})

	it('refuses a test 9.9 s after the last one started', async () => {
		await tester.test('gemini')
		after(9900)

		expect(await tester.test('gemini')).toEqual({ status: 'too_soon', retryAfterMs: 100 })
	})

	it('allows a test 10 s after the last one started', async () => {
		await tester.test('gemini')
		after(engineTestCooldownMs)

		expect(await tester.test('gemini')).toMatchObject({ status: 'done', result: { outcome: 'ok' } })
	})

	it('releases the guard when the engine throws', async () => {
		failWith(new TypeError('Not a function'))
		await tester.test('gemini')

		gemini.state.answer = async () => {
			// Answers at once.
		}

		after(engineTestCooldownMs)

		expect(await tester.test('gemini')).toMatchObject({ status: 'done', result: { outcome: 'ok' } })
	})

	it.each(['agent-command', 'openai-compatible'] as const)(
		'answers not_set_up for %s when it is not configured, without a call',
		async (id) => {
			const unconfigured = createEngineTester({
				engines: { 'agent-command': null, gemini: gemini.engine, 'openai-compatible': null },
				settings: () => ({ engines: defaultEngines(), routing: defaultRouting() }),
				agentCommand: null,
			})

			expect([await unconfigured.test(id), gemini.state.received.length]).toEqual([
				{ status: 'not_set_up' },
				0,
			])
		},
	)

	it('answers not_set_up for Gemini without a key', async () => {
		const unconfigured = createEngineTester({
			engines: { 'agent-command': null, gemini: gemini.engine, 'openai-compatible': null },
			settings: () => ({ engines: defaultEngines(), routing: defaultRouting() }),
			agentCommand: agentCommand(),
		})

		expect([await unconfigured.test('gemini'), gemini.state.received.length]).toEqual([
			{ status: 'not_set_up' },
			0,
		])
	})
})
