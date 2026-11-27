// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { beforeEach, describe, expect, it } from 'bun:test'
import { configuredSettingsFactory } from '#tests/factories/settings'
import { createTestDb, type TestDb } from '#tests/setup/db'

import { readSettings, updateSettings, type Settings } from '#/features/settings/server'

import { setCategoryRoute } from './category-route'

describe('setCategoryRoute', () => {
	let db: TestDb
	let configured: Settings

	beforeEach(async () => {
		;({ db } = await createTestDb())
		configured = configuredSettingsFactory.build()
		updateSettings(db, configured)
	})

	it('sets a route and keeps the others and the fallback order', () => {
		setCategoryRoute(db, 7, { engine: 'openai-compatible', tier: 'standard' })

		expect(readSettings(db).routing).toEqual({
			categories: {
				...configured.routing.categories,
				'7': { engine: 'openai-compatible', tier: 'standard' },
			},
			fallbackOrder: configured.routing.fallbackOrder,
		})
	})

	it('replaces the route a category had', () => {
		setCategoryRoute(db, 3, { engine: 'gemini', tier: 'fast' })

		expect(readSettings(db).routing.categories).toEqual({ '3': { engine: 'gemini', tier: 'fast' } })
	})

	it('removes a route with null', () => {
		setCategoryRoute(db, 3, null)

		expect(readSettings(db).routing.categories).toEqual({})
	})

	it('keeps both of two changes in a row', () => {
		setCategoryRoute(db, 7, { engine: 'gemini', tier: 'standard' })
		setCategoryRoute(db, 8, { engine: 'openai-compatible', tier: 'deep' })

		expect(Object.keys(readSettings(db).routing.categories).toSorted()).toEqual(['3', '7', '8'])
	})
})
