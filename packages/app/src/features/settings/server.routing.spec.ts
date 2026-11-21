// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { beforeEach, describe, expect, it } from 'bun:test'
import { configuredSettingsFactory } from '#tests/factories/settings'
import { createTestDb, type TestDb } from '#tests/setup/db'

import { settings as settingsTable } from '#/server/db/schema/settings'

import { readSettings, removeCategoryRouting, updateSettings } from './server'

describe('removeCategoryRouting', () => {
	let db: TestDb

	beforeEach(async () => {
		;({ db } = await createTestDb())
	})

	it('removes just the requested override', () => {
		const configured = configuredSettingsFactory.build()
		updateSettings(db, configured)
		updateSettings(db, {
			routing: {
				categories: { ...configured.routing.categories, '7': { engine: 'gemini', tier: 'fast' } },
			},
		})

		db.transaction((tx) => {
			removeCategoryRouting(tx, 7)
		})

		expect(readSettings(db)).toEqual(configured)
	})

	it('leaves routing at its defaults when nothing was stored', () => {
		db.transaction((tx) => {
			removeCategoryRouting(tx, 7)
		})

		expect(db.select().from(settingsTable).all()).toEqual([])
	})
})
