// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { describe, expect, it } from 'bun:test'
import * as v from 'valibot'

import { configuredEngines, defaultEngines, enginesPatchSchema } from './settings'

function issuesFor(baseUrl: string) {
	const result = v.safeParse(enginesPatchSchema, { 'openai-compatible': { baseUrl } })

	return result.issues?.map((issue) => issue.message) ?? []
}

describe('engine settings', () => {
	describe('an OpenAI-compatible base URL', () => {
		it.each(['https://api.example.com/v1', 'http://localhost:11434/v1'])('accepts %s', (url) => {
			expect(issuesFor(url)).toEqual([])
		})

		it.each([
			'https://user:sk-pass@proxy.example.com/v1',
			'https://sk-token@proxy.example.com/v1',
			'https://proxy.example.com/v1?api-key=sk-q',
			'https://proxy.example.com/v1#sk-q',
		])('refuses a credential in %s', (url) => {
			expect(issuesFor(url)).toEqual(['Leave credentials out of the URL; put the key in apiKey'])
		})

		it('reports text that is not a URL without a credential issue', () => {
			const issues = issuesFor('not a url')

			expect(issues.at(-1)).toBe('Use an http or https URL')
			expect(issues).toHaveLength(2)
		})
	})

	describe("Gemini's limits", () => {
		it.each([0, 1])('refuse %d requests, which no card fits', (perMinute) => {
			const patch = { gemini: { limits: { fast: { perMinute, perDay: null } } } }

			expect(v.safeParse(enginesPatchSchema, patch).success).toBe(false)
		})

		it('take two requests and no limit', () => {
			const patch = { gemini: { limits: { deep: { perMinute: 2, perDay: null } } } }

			expect(v.safeParse(enginesPatchSchema, patch).success).toBe(true)
		})
	})

	describe('configuredEngines', () => {
		describe('on a new instance', () => {
			it('finds none', () => {
				expect(configuredEngines(defaultEngines(), null)).toEqual([])
			})
		})

		describe('with the agent command variable set', () => {
			it('counts the agent command engine', () => {
				expect(configuredEngines(defaultEngines(), 'agent --tier {tier}')).toEqual([
					'agent-command',
				])
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
})
