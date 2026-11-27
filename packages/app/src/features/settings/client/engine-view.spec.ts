// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { describe, expect, it } from 'bun:test'
import { publicSettingsFactory } from '#tests/factories/settings'

import { en } from '#/lib/i18n/en'

import type { EngineId } from '../shared/engines'
import type { EngineOverview, EngineTestResult } from '../shared/types'
import {
	engineBadge,
	engineDescription,
	engineMeta,
	engineState,
	engineSummary,
	fallbackRoles,
	fullFallbackOrder,
	testResultLine,
} from './engine-view'

const strings = en.settings.engines

function engine(id: EngineId, state: EngineOverview['state']): EngineOverview {
	return {
		id,
		configured: state !== 'not_set_up',
		state,
		lastCallAt: null,
		lastOutcome: null,
		today: { suggestions: 0, cards: 0 },
	}
}

const context = { locale: 'en', timeZone: 'Europe/Berlin' }

const testedAt = '2026-11-20T08:00:00.000Z'

function badge(state: EngineOverview['state']) {
	return engineBadge({ state, result: null }, context, en.settings.engineState)
}

function line(result: EngineTestResult) {
	return testResultLine(result, context, en.settings.testOutcome)
}

describe('engine view', () => {
	describe('engineSummary', () => {
		it('names the engine that needs attention first', () => {
			expect(
				engineSummary(
					[
						engine('agent-command', 'failing'),
						engine('gemini', 'working'),
						engine('openai-compatible', 'key_rejected'),
					],
					strings,
				),
			).toBe('OpenAI-compatible needs attention')
		})

		it('names the first working engine in display order', () => {
			expect(
				engineSummary(
					[
						engine('agent-command', 'working'),
						engine('gemini', 'working'),
						engine('openai-compatible', 'limited'),
					],
					strings,
				),
			).toBe('Gemini works')
		})

		it('says when no engine is set up', () => {
			expect(
				engineSummary(
					[
						engine('agent-command', 'not_set_up'),
						engine('gemini', 'not_set_up'),
						engine('openai-compatible', 'not_set_up'),
					],
					strings,
				),
			).toBe('Not set up')
		})

		it('says when the set-up engines are not tested yet', () => {
			expect(
				engineSummary(
					[
						engine('agent-command', 'untested'),
						engine('gemini', 'not_set_up'),
						engine('openai-compatible', 'untested'),
					],
					strings,
				),
			).toBe('Not tested yet')
		})
	})

	describe('engineState and engineBadge', () => {
		it('takes the latest test on the page over the server state', () => {
			const result: EngineTestResult = { engine: 'gemini', testedAt, outcome: 'auth' }

			expect(engineState(engine('gemini', 'working'), result)).toBe('key_rejected')
			expect(engineState(engine('gemini', 'working'), null)).toBe('working')
		})

		it('maps each state to its badge', () => {
			expect([
				badge('working'),
				badge('limited'),
				badge('key_rejected'),
				badge('failing'),
				badge('untested'),
				badge('not_set_up'),
			]).toEqual([
				{ status: 'ready', label: 'Working' },
				{ status: 'queued', label: 'At its limit' },
				{ status: 'failed', label: 'Key rejected' },
				{ status: 'failed', label: 'Failing' },
				{ status: null, label: 'Not tested' },
				{ status: null, label: 'Not set up' },
			])
		})

		it('says when a limit tested on the page resets, in the digest time zone', () => {
			const result: EngineTestResult = {
				engine: 'gemini',
				testedAt,
				outcome: 'rate_limited',
				resetsAt: '2026-11-20T08:00:00.000Z',
			}

			expect(engineBadge({ state: 'limited', result }, context, en.settings.engineState)).toEqual({
				status: 'queued',
				label: 'At its limit until 09:00',
			})
		})
	})

	describe('engineDescription', () => {
		it('names the endpoint host and the standard model', () => {
			const { engines } = publicSettingsFactory.build()

			const openAi = {
				...engines['openai-compatible'],
				baseUrl: 'https://api.example.com/v1',
				models: { fast: null, standard: 'model-s', deep: null },
			}

			expect(
				engineDescription(
					'openai-compatible',
					{ ...engines, 'openai-compatible': openAi },
					en.settings.engines,
				),
			).toBe('Backup writer: api.example.com, model-s. Text only, no search.')
		})

		it('says less without an endpoint', () => {
			const { engines } = publicSettingsFactory.build()

			expect(engineDescription('openai-compatible', engines, en.settings.engines)).toBe(
				'Backup writer. Text only, no search.',
			)
			expect(engineDescription('gemini', engines, en.settings.engines)).toBe(
				en.settings.engines.geminiText,
			)
		})
	})

	describe('testResultLine', () => {
		it('says each outcome', () => {
			expect([
				line({ engine: 'gemini', testedAt, outcome: 'ok', elapsedMs: 812, model: 'm' }),
				line({ engine: 'gemini', testedAt, outcome: 'rate_limited', resetsAt: testedAt }),
				line({ engine: 'gemini', testedAt, outcome: 'auth' }),
				line({ engine: 'gemini', testedAt, outcome: 'timeout' }),
				line({ engine: 'gemini', testedAt, outcome: 'invalid' }),
				line({ engine: 'gemini', testedAt, outcome: 'error' }),
			]).toEqual([
				'Answered in 0.8 s',
				'At its limit until 09:00',
				'The provider rejected the key',
				'No answer within 15 s',
				'Answered, but not in the expected shape',
				'Could not reach it. The server log has the reason',
			])
		})
	})

	describe('engineMeta', () => {
		const now = new Date('2026-11-20T10:00:00.000Z')

		it('says the last call and today’s counts', () => {
			const overview = {
				...engine('gemini', 'working'),
				lastCallAt: '2026-11-20T09:58:00.000Z',
				today: { suggestions: 42, cards: 18 },
			}

			expect(engineMeta({ overview, result: null }, { ...context, now }, en.settings)).toBe(
				'Last call 2 min ago · 42 suggestions and 18 cards today',
			)
		})

		it('shows a test result instead', () => {
			const result: EngineTestResult = { engine: 'gemini', testedAt, outcome: 'timeout' }

			expect(
				engineMeta(
					{ overview: engine('gemini', 'working'), result },
					{ ...context, now },
					en.settings,
				),
			).toBe('No answer within 15 s')
		})

		it('says no calls for a set-up engine and nothing for one that is not', () => {
			expect(
				engineMeta(
					{ overview: engine('gemini', 'untested'), result: null },
					{ ...context, now },
					en.settings,
				),
			).toBe('No calls yet')
			expect(
				engineMeta(
					{ overview: engine('gemini', 'not_set_up'), result: null },
					{ ...context, now },
					en.settings,
				),
			).toBe(null)
		})
	})

	describe('fallbackRoles', () => {
		it('starts with Gemini, as the router does, and skips engines that are not set up', () => {
			const roles = fallbackRoles(['openai-compatible', 'gemini', 'agent-command'], {
				configured: new Set<EngineId>(['gemini', 'openai-compatible']),
				listed: new Set<EngineId>(['openai-compatible', 'gemini', 'agent-command']),
			})

			expect(Object.fromEntries(roles)).toEqual({
				'openai-compatible': { role: 'backup', main: 'gemini' },
				gemini: { role: 'main' },
				'agent-command': { role: 'skipped' },
			})
		})

		it('makes the first set-up engine the main one without Gemini', () => {
			const roles = fallbackRoles(['gemini', 'agent-command', 'openai-compatible'], {
				configured: new Set<EngineId>(['agent-command', 'openai-compatible']),
				listed: new Set<EngineId>(['gemini', 'agent-command', 'openai-compatible']),
			})

			expect(Object.fromEntries(roles)).toEqual({
				gemini: { role: 'skipped' },
				'agent-command': { role: 'main' },
				'openai-compatible': { role: 'backup', main: 'agent-command' },
			})
		})

		it('skips a set-up engine the stored order leaves out, as the router does', () => {
			const roles = fallbackRoles(['gemini', 'openai-compatible', 'agent-command'], {
				configured: new Set<EngineId>(['agent-command']),
				listed: new Set<EngineId>(['gemini', 'openai-compatible']),
			})

			expect(roles.get('agent-command')).toEqual({ role: 'unlisted' })
		})
	})

	describe('fullFallbackOrder', () => {
		it('adds the engines the stored order leaves out', () => {
			expect(fullFallbackOrder(['openai-compatible', 'gemini'])).toEqual([
				'openai-compatible',
				'gemini',
				'agent-command',
			])
		})
	})
})
