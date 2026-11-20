// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { afterEach, beforeEach, describe, expect, it, mock, setSystemTime } from 'bun:test'
import { toJsonSchema } from '@valibot/to-json-schema'
import {
	cardInputFactory,
	privateNoteFactory,
	suggestInputFactory,
} from '#tests/factories/engine-input'
import { agentCommand, configuredSettingsFactory } from '#tests/factories/settings'
import { createTestDb } from '#tests/setup/db'
import { errorOf } from '#tests/setup/engines'
import * as v from 'valibot'

import {
	EngineError,
	parseOutput,
	type EngineInput,
	type JsonValue,
	type OutputFormat,
	type Redacted,
	type RunOptions,
	type Tier,
} from './contract'
import {
	createEngines,
	createRouter,
	resolveRoute,
	type Router,
	type RouterSettings,
} from './router'
import { defaultRouting, type EngineId } from './settings'

const { db } = await createTestDb()

const glossarySchema = v.strictObject({ summary: v.string() })

const glossary: OutputFormat<typeof glossarySchema> = {
	id: 'technology',
	instructions: 'Explain the term in one sentence.',
	schema: glossarySchema,
	jsonSchema: toJsonSchema(glossarySchema),
}

const card = { ...cardInputFactory.build(), output: glossary }

const report = { ...card, task: 'research', output: { ...glossary, id: 'report' } } as const

const command = agentCommand()

const { engines: configured, routing: overridden } = configuredSettingsFactory.build()

const settings: RouterSettings = { engines: configured, routing: defaultRouting() }

const now = new Date('2026-11-20T10:00:00Z')

const resetsAt = new Date('2026-11-20T11:00:00Z')

function limited(at = resetsAt) {
	return new EngineError({ kind: 'rate_limited', resetsAt: at }, 'The limit is reached')
}

interface FakeState {
	readonly calls: { readonly input: Redacted<EngineInput>; readonly tier: Tier }[]
	failure: Error | null
}

/** An engine that records what it receives and answers, or fails with `failure` while it is set. */
function fakeEngine(id: EngineId) {
	const state: FakeState = { calls: [], failure: null }

	async function run<TSchema extends v.GenericSchema>(
		input: Redacted<EngineInput & { readonly output: OutputFormat<TSchema> }>,
		{ tier }: RunOptions,
	) {
		state.calls.push({ input, tier })

		if (state.failure !== null) {
			throw state.failure
		}

		const answer: JsonValue =
			input.task === 'suggest'
				? { categories: ['technology'], senses: [], language: 'en' }
				: { summary: 'A JavaScript runtime.' }

		const output = parseOutput(input.output, answer)

		return { output, engine: id, model: null, searchSuggestions: null, elapsedMs: 0 }
	}

	return { engine: { id, suggest: run, explain: run, research: run }, state }
}

type Fake = ReturnType<typeof fakeEngine>

describe('engine router', () => {
	describe('resolveRoute', () => {
		it.each([
			[{ task: 'suggest', format: 'suggestion' }, 'fast', ['gemini', 'openai-compatible']],
			[{ task: 'explain', format: 'vocabulary' }, 'fast', ['gemini', 'openai-compatible']],
			[{ task: 'explain', format: 'technology' }, 'standard', ['gemini', 'openai-compatible']],
			[{ task: 'research', format: 'report' }, 'deep', ['gemini']],
		] as const)('routes %p to the %s tier', (request, tier, path) => {
			expect(resolveRoute({ ...request, categoryId: 1 }, settings, command)).toEqual({ tier, path })
		})

		it("takes a category's engine and tier from settings", () => {
			const request = { task: 'explain', format: 'technology', categoryId: 3 } as const

			expect(resolveRoute(request, { engines: configured, routing: overridden }, command)).toEqual({
				tier: 'deep',
				path: ['agent-command', 'gemini', 'openai-compatible'],
			})
		})

		it('skips an engine that is not configured, the routed one included', () => {
			const engines = { ...configured, gemini: { ...configured.gemini, apiKey: null } }
			const request = { task: 'explain', format: 'technology', categoryId: 3 } as const

			expect(resolveRoute(request, { engines, routing: overridden }, null)).toEqual({
				tier: 'deep',
				path: ['openai-compatible'],
			})
		})
	})

	describe('createRouter', () => {
		let gemini: Fake
		let openAi: Fake
		let agent: Fake
		let router: Router

		function fakes() {
			return {
				'agent-command': agent.engine,
				gemini: gemini.engine,
				'openai-compatible': openAi.engine,
			}
		}

		function start(current: RouterSettings, line: string | null = command) {
			router = createRouter({ db, settings: () => current, agentCommand: line, build: fakes })
		}

		beforeEach(() => {
			setSystemTime(now)
			gemini = fakeEngine('gemini')
			openAi = fakeEngine('openai-compatible')
			agent = fakeEngine('agent-command')
			start(settings)
		})

		afterEach(() => {
			setSystemTime()
		})

		describe('when the primary engine is limited', () => {
			beforeEach(() => {
				gemini.state.failure = limited()
			})

			it('returns a draft from the next engine, to redo at the reset', async () => {
				expect(await router.explain(card, { categoryId: 1 })).toMatchObject({
					engine: 'openai-compatible',
					draft: true,
					redoAt: resetsAt,
				})
			})

			it('skips the engine without a call until the reset, then goes back to it', async () => {
				await router.explain(card, { categoryId: 1 })
				gemini.state.failure = null
				const beforeReset = await router.explain(card, { categoryId: 1 })
				setSystemTime(new Date(resetsAt.getTime() + 1))
				const afterReset = await router.explain(card, { categoryId: 1 })

				expect([beforeReset, afterReset, gemini.state.calls.length]).toMatchObject([
					{ engine: 'openai-compatible', draft: true, redoAt: resetsAt },
					{ engine: 'gemini', draft: false },
					2,
				])
			})

			it("keeps the limit to the tier's model", async () => {
				await router.suggest(suggestInputFactory.build())
				gemini.state.failure = null

				expect(await router.explain(card, { categoryId: 1 })).toMatchObject({ engine: 'gemini' })
			})

			it('shows a suggestion from the next engine, never as a draft', async () => {
				const suggestion = await router.suggest(suggestInputFactory.build())

				expect(suggestion.engine).toBe('openai-compatible')
				expect(suggestion).not.toHaveProperty('draft')
			})

			it('skips engines that are not configured in the fallback order', async () => {
				// The order starts with the agent command, which has no command here.
				start({ engines: configured, routing: overridden }, null)

				expect(await router.explain(card, { categoryId: 1 })).toMatchObject({
					engine: 'openai-compatible',
				})
				expect(agent.state.calls).toHaveLength(0)
			})

			it("throws the primary engine's limit when every engine is limited", async () => {
				openAi.state.failure = limited(new Date('2026-11-20T12:00:00Z'))

				expect(await errorOf(router.explain(card, { categoryId: 1 }))).toMatchObject({
					failure: { kind: 'rate_limited', resetsAt },
				})
			})

			it('makes research wait for the reset instead of falling back', async () => {
				const error = await errorOf(router.research(report, { categoryId: 1 }))

				expect(error).toMatchObject({ failure: { kind: 'rate_limited', resetsAt } })
				expect(openAi.state.calls).toHaveLength(0)
			})
		})

		describe("when the primary engine's key is rejected", () => {
			it('falls back without a draft and tries the engine again on the next call', async () => {
				gemini.state.failure = new EngineError({ kind: 'auth' }, 'The key is rejected')
				const fallback = await router.explain(card, { categoryId: 1 })
				gemini.state.failure = null
				const fixed = await router.explain(card, { categoryId: 1 })

				expect([fallback, fixed]).toMatchObject([
					{ engine: 'openai-compatible', draft: false },
					{ engine: 'gemini', draft: false },
				])
			})
		})

		describe('when the primary engine fails otherwise', () => {
			it.each([
				new EngineError({ kind: 'timeout', afterMs: 1000 }, 'No answer in time'),
				new EngineError({ kind: 'invalid', issues: ['summary: Invalid type'] }, 'Invalid'),
				new Error('The process exited'),
			])('throws %p at once, without falling back', async (failure) => {
				gemini.state.failure = failure

				expect(await errorOf(router.explain(card, { categoryId: 1 }))).toBe(failure)
				expect(openAi.state.calls).toHaveLength(0)
			})
		})

		describe('with a private note', () => {
			it('sends every engine on the path the same input, with only the term', async () => {
				const note = privateNoteFactory.build()
				gemini.state.failure = limited()
				await router.explain({ ...card, note }, { categoryId: 1 })
				const [first, second] = [gemini.state.calls[0]?.input, openAi.state.calls[0]?.input]

				expect(second).toBe(first)
				expect(first).toMatchObject({
					note: { term: note.term, text: null, context: null, url: null },
					previous: [],
				})
			})
		})

		describe('engines', () => {
			it('builds them once for every call', async () => {
				const build = mock(() => ({
					'agent-command': null,
					gemini: gemini.engine,
					'openai-compatible': openAi.engine,
				}))

				router = createRouter({ db, settings: () => settings, agentCommand: null, build })
				await router.suggest(suggestInputFactory.build())
				await router.explain(card, { categoryId: 1 })
				await router.research(report, { categoryId: 1 })

				expect(build).toHaveBeenCalledTimes(1)
				expect(gemini.state.calls.map(({ tier }) => tier)).toEqual(['fast', 'standard', 'deep'])
			})
		})
	})

	describe('createEngines', () => {
		it('builds the agent command engine only when its command is set', () => {
			const without = createEngines({ db, settings: () => settings, agentCommand: null })
			const withCommand = createEngines({ db, settings: () => settings, agentCommand: command })

			expect([without, withCommand]).toMatchObject([
				{ 'agent-command': null, gemini: { id: 'gemini' }, 'openai-compatible': {} },
				{ 'agent-command': { id: 'agent-command' } },
			])
		})
	})
})
