// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { beforeEach, describe, expect, it } from 'bun:test'
import { listedCategoryFactory } from '#tests/factories/categories'
import { configuredSettingsFactory } from '#tests/factories/settings'
import { createTestDb, type TestDb } from '#tests/setup/db'

import { updateSettings, type Settings } from '#/features/settings/server'

import { readCategoryEditor } from './category-editor'

describe('readCategoryEditor', () => {
	let db: TestDb

	const technology = listedCategoryFactory.build({
		id: 3,
		name: 'Technology',
		icon: 'tech',
		color: 'tech',
		format: 'technology',
		noteCount: 23,
	})

	const english = listedCategoryFactory.build({ id: 1, name: 'English' })

	beforeEach(async () => {
		;({ db } = await createTestDb())
	})

	describe('with no engine set up', () => {
		it('starts a new category with no default engine', () => {
			expect(readCategoryEditor(db, [english, technology], null)).toEqual({
				id: null,
				initial: {
					name: '',
					icon: 'other',
					color: 'other',
					format: 'brief',
					instructions: '',
					engine: null,
				},
				noteCount: 0,
				others: [
					{ id: 1, name: 'English' },
					{ id: 3, name: 'Technology' },
				],
				defaultEngine: null,
				configured: [],
			})
		})

		it('is null for a category that is not there', () => {
			expect(readCategoryEditor(db, [english], 9)).toBeNull()
		})
	})

	describe('with Gemini and the OpenAI-compatible engine set up', () => {
		let settings: Settings

		beforeEach(() => {
			settings = configuredSettingsFactory.build()
			updateSettings(db, settings)
		})

		it('reads the category, its route and the engine that writes by default', () => {
			const data = readCategoryEditor(db, [english, technology], 3)

			expect(data).toMatchObject({
				id: 3,
				initial: { name: 'Technology', icon: 'tech', color: 'tech', format: 'technology' },
				noteCount: 23,
				others: [{ id: 1, name: 'English' }],
				defaultEngine: 'gemini',
				configured: ['gemini', 'openai-compatible'],
			})
			// The factory routes category 3 to the agent command.
			expect(data?.initial.engine).toBe('agent-command')
		})

		it('hands on no key', () => {
			const text = JSON.stringify(readCategoryEditor(db, [english, technology], 3))

			expect(text).not.toContain(settings.engines.gemini.apiKey)
			expect(text).not.toContain(settings.engines['openai-compatible'].apiKey)
		})
	})
})
