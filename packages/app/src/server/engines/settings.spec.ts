// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { describe, expect, it } from 'bun:test'

import { configuredEngines, defaultEngines } from './settings'

describe('configuredEngines', () => {
	describe('on a new instance', () => {
		it('finds none', () => {
			expect(configuredEngines(defaultEngines(), null)).toEqual([])
		})
	})

	describe('with the agent command variable set', () => {
		it('counts the agent command engine', () => {
			expect(configuredEngines(defaultEngines(), 'agent --tier {tier}')).toEqual(['agent-command'])
		})
	})

	describe('with keys and a base URL in settings', () => {
		const engines = {
			...defaultEngines(),
			gemini: { ...defaultEngines().gemini, apiKey: 'gemini-key' },
			'openai-compatible': {
				...defaultEngines()['openai-compatible'],
				baseUrl: 'http://localhost:11434/v1',
			},
		}

		it('counts Gemini with a key and an endpoint without one', () => {
			expect(configuredEngines(engines, null)).toEqual(['gemini', 'openai-compatible'])
		})

		it('still needs the variable for the agent command', () => {
			expect(configuredEngines(engines, null)).not.toContain('agent-command')
		})
	})
})
