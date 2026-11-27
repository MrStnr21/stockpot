// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { beforeEach, describe, expect, it } from 'bun:test'
import { configuredSettingsFactory } from '#tests/factories/settings'
import { createTestDb, type TestDb } from '#tests/setup/db'

import { settings as settingsTable } from '#/server/db/schema/settings'

import { readSettings, updateSettings, updateSettingsWith, type Settings } from './server'

describe('updateSettingsWith', () => {
	let db: TestDb
	let configured: Settings

	beforeEach(async () => {
		;({ db } = await createTestDb())
		configured = configuredSettingsFactory.build({ digest: { limit: 10 } })
		updateSettings(db, configured)
	})

	it('builds the patch from the stored settings and stores it', () => {
		const returned = updateSettingsWith(db, ({ digest }) => ({
			digest: { limit: digest.limit + 1 },
		}))

		const expected = { ...configured, digest: { ...configured.digest, limit: 11 } }

		expect([returned, readSettings(db)]).toEqual([expected, expected])
	})

	it('writes only the sections the built patch names', () => {
		const before = db.select().from(settingsTable).all()

		updateSettingsWith(db, () => ({ cardLanguage: 'fr' }))

		const after = db.select().from(settingsTable).all()

		expect(after.filter(({ key }) => key !== 'cardLanguage')).toEqual(
			before.filter(({ key }) => key !== 'cardLanguage'),
		)
	})

	it('sees the change before it, so two changes in a row keep both', () => {
		updateSettingsWith(db, ({ routing }) => ({
			routing: { categories: { ...routing.categories, '7': { engine: 'gemini', tier: 'fast' } } },
		}))
		updateSettingsWith(db, ({ routing }) => ({
			routing: { categories: { ...routing.categories, '8': { engine: 'gemini', tier: 'deep' } } },
		}))

		expect(Object.keys(readSettings(db).routing.categories).toSorted()).toEqual(['3', '7', '8'])
	})
})
