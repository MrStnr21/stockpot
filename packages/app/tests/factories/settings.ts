// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { faker } from '@faker-js/faker'
import { Factory } from 'fishery'

import type { Settings } from '#/features/settings/server'
import type { PublicSettings } from '#/features/settings/shared/types'

function models() {
	return {
		fast: faker.string.alphanumeric(12),
		standard: faker.string.alphanumeric(12),
		deep: faker.string.alphanumeric(12),
	}
}

/** A command line for the agent command engine, which comes from the environment, not settings. */
export function agentCommand(): string {
	return `agent --tier {tier} --token ${faker.string.alphanumeric(32)}`
}

/** Settings with every engine in them configured: each key holds a random value. */
export const configuredSettingsFactory = Factory.define<Settings>(() => ({
	digest: {
		time: '07:15',
		batchTime: '05:45',
		limit: faker.number.int({ min: 1, max: 50 }),
		timeZone: 'Asia/Tokyo',
	},
	cardLanguage: 'de',
	engines: {
		gemini: {
			apiKey: faker.string.alphanumeric(39),
			models: models(),
			limits: {
				fast: { perMinute: faker.number.int({ min: 2, max: 30 }), perDay: 1000 },
				standard: { perMinute: null, perDay: faker.number.int({ min: 2, max: 250 }) },
				deep: { perMinute: null, perDay: null },
			},
		},
		'openai-compatible': {
			baseUrl: faker.internet.url(),
			apiKey: faker.string.alphanumeric(48),
			models: models(),
		},
	},
	routing: {
		categories: { '3': { engine: 'agent-command', tier: 'deep' } },
		fallbackOrder: ['agent-command', 'gemini', 'openai-compatible'],
	},
}))

/** Settings as `GET /api/settings` answers: no key, each engine's key as its state. */
export const publicSettingsFactory = Factory.define<PublicSettings>(() => ({
	digest: {
		time: '08:30',
		batchTime: '06:30',
		limit: faker.number.int({ min: 1, max: 50 }),
		timeZone: 'Europe/Berlin',
	},
	cardLanguage: 'en',
	engines: {
		'agent-command': { command: 'not set' },
		gemini: {
			apiKey: 'set',
			models: models(),
			limits: {
				fast: { perMinute: null, perDay: null },
				standard: { perMinute: null, perDay: null },
				deep: { perMinute: null, perDay: null },
			},
		},
		'openai-compatible': { baseUrl: null, apiKey: 'not set', models: models() },
	},
	routing: { categories: {}, fallbackOrder: ['gemini', 'openai-compatible', 'agent-command'] },
}))
