// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { beforeEach, describe, expect, it } from 'bun:test'
import { configuredSettingsFactory } from '#tests/factories/settings'
import { createTestDb, type TestDb } from '#tests/setup/db'

import { updateSettings, type Settings } from '#/features/settings/server'

import { readSettingsOverview } from './overview'

describe('readSettingsOverview', () => {
	let db: TestDb
	let configured: Settings

	beforeEach(async () => {
		;({ db } = await createTestDb())
		configured = configuredSettingsFactory.build()
		updateSettings(db, configured)
	})

	it('carries no key', () => {
		const text = JSON.stringify(readSettingsOverview(db, new Date()))

		expect(text).not.toContain(configured.engines.gemini.apiKey)
		expect(text).not.toContain(configured.engines['openai-compatible'].apiKey)
	})

	it('reports each set-up engine as untested before any call', () => {
		const { engines, attention, settings } = readSettingsOverview(db, new Date())

		expect(engines.map(({ id, state }) => [id, state])).toEqual([
			['agent-command', 'not_set_up'],
			['gemini', 'untested'],
			['openai-compatible', 'untested'],
		])
		expect(attention).toBe(false)
		expect(settings.engines.gemini.apiKey).toBe('set')
	})
})
