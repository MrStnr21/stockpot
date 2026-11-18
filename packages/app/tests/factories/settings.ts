// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { faker } from '@faker-js/faker'
import { Factory } from 'fishery'

import type { Settings } from '#/features/settings/server'

function models() {
	return {
		fast: faker.string.alphanumeric(12),
		standard: faker.string.alphanumeric(12),
		deep: faker.string.alphanumeric(12),
	}
}

/** Settings with every engine configured: each key and the agent command holds a random value. */
export const configuredSettingsFactory = Factory.define<Settings>(() => ({
	digest: { time: '07:15', limit: faker.number.int({ min: 1, max: 50 }), timeZone: 'Asia/Tokyo' },
	cardLanguage: 'de',
	engines: {
		'agent-command': { command: `agent --tier {tier} --token ${faker.string.alphanumeric(32)}` },
		gemini: { apiKey: faker.string.alphanumeric(39), models: models() },
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
