// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test'
import { categoryRowFactory } from '#tests/factories/categories'
import { configuredSettingsFactory } from '#tests/factories/settings'
import { termRowFactory } from '#tests/factories/terms'
import { createTestDb } from '#tests/setup/db'

import * as instance from '#/server/db/instance'
import * as engines from '#/server/engines/router'

import { instanceSuggester } from './instance'

const { db } = await createTestDb()

describe('instanceSuggester', () => {
	beforeEach(() => {
		spyOn(instance, 'instanceDb').mockResolvedValue(db)
		spyOn(engines, 'createRouter').mockImplementation(() => {
			throw new Error('Invalid command')
		})
	})

	afterEach(() => {
		mock.restore()
	})

	it('answers history when the router cannot be built', async () => {
		const { id } = await categoryRowFactory.transient({ db }).create()
		const { term } = termRowFactory.build()
		const service = await instanceSuggester()

		const answer = await service.suggest(db, {
			note: { text: term, context: null, url: null, isPrivate: false },
			history: [{ categoryId: id, meaning: '' }],
			language: configuredSettingsFactory.build().cardLanguage,
		})

		expect(answer).toEqual({
			categories: [id],
			senses: [],
			language: null,
			source: 'history',
			pending: false,
		})
		expect(engines.createRouter).not.toHaveBeenCalled()
	})
})
