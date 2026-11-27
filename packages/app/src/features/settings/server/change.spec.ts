// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { describe, expect, it } from 'bun:test'
import { faker } from '@faker-js/faker'
import * as v from 'valibot'

import type { JsonValue } from '#/server/engines/contract'

import { settingsChangeSchema } from './change'

function issuesOf(change: JsonValue) {
	return v.safeParse(settingsChangeSchema, change).issues ?? []
}

/** Where each issue is, as `readJson` names it. */
function pathsOf(change: JsonValue) {
	return issuesOf(change).map((issue) => v.getDotPath(issue) ?? 'body')
}

describe('settingsChangeSchema', () => {
	it.each([
		['an empty body', {}, 'body'],
		['an unknown section', { theme: 'dark' }, 'theme'],
		['an unknown digest field', { digest: { weekly: true } }, 'digest.weekly'],
		['Gemini limits', { engines: { gemini: { limits: {} } } }, 'engines.gemini.limits'],
		['an unknown engine', { engines: { local: {} } }, 'engines.local'],
		[
			'an unknown model tier',
			{ engines: { gemini: { models: { turbo: 'x' } } } },
			'engines.gemini.models.turbo',
		],
		[
			'the agent command',
			{ engines: { 'agent-command': { command: 'x' } } },
			'engines.agent-command',
		],
		[
			'per-category routes',
			{ routing: { fallbackOrder: ['gemini'], categories: {} } },
			'routing.categories',
		],
	])('refuses %s', (_name, change, path) => {
		expect(pathsOf(change)).toEqual([path])
	})

	it('canonicalises the time zone', () => {
		expect(v.parse(settingsChangeSchema, { digest: { timeZone: 'europe/berlin' } })).toEqual({
			digest: { timeZone: 'Europe/Berlin' },
		})
	})

	it.each([
		['time', '24:00'],
		['time', '7:5'],
		['batchTime', '24:00'],
		['timeZone', '+05:00'],
		['limit', 0],
		['limit', 51],
		['limit', 1.5],
	])('refuses digest.%s %p', (field, value) => {
		expect(pathsOf({ digest: { [field]: value } })).toEqual([`digest.${field}`])
	})

	it.each([1, 50])('accepts a limit of %p', (limit) => {
		expect(pathsOf({ digest: { limit } })).toEqual([])
	})

	it('accepts a key, a model and the fallback order together', () => {
		const change = {
			engines: {
				'openai-compatible': {
					baseUrl: 'http://127.0.0.1:8080/v1',
					apiKey: faker.string.alphanumeric(48),
					models: { standard: null },
				},
			},
			routing: { fallbackOrder: ['openai-compatible', 'gemini'] },
		}

		// Widened, so the readonly literal compares with the parsed value.
		const parsed: object = v.parse(settingsChangeSchema, change)

		expect(parsed).toEqual(change)
	})

	it.each([
		['too long', faker.string.alphanumeric(4097)],
		['a number', faker.number.int({ min: 10 ** 12, max: 10 ** 15 })],
	])('never quotes a key that is %s', (_name, key) => {
		const issues = issuesOf({ engines: { gemini: { apiKey: key } } })

		expect(issues.map(({ message }) => message.includes(String(key)))).toEqual([false])
	})
})
