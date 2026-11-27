// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { publicSettingsFactory } from '#tests/factories/settings'
import { SettingsFetch } from '#tests/setup/settings-fetch'

import { en } from '#/lib/i18n/en'

import type { PublicSettings } from '../shared/types'
import { EngineModels, fieldIssues, modelsChange, type ModelValues } from './engine-models.svelte'
import { createSettingsApi } from './settings-api'
import { SettingsToasts } from './settings-toasts.svelte'

const saved: ModelValues = { baseUrl: '', fast: 'f-1', standard: 's-1', deep: '' }

function openAi(change: Partial<PublicSettings['engines']['openai-compatible']>): PublicSettings {
	const settings = publicSettingsFactory.build()

	return {
		...settings,
		engines: {
			...settings.engines,
			'openai-compatible': { ...settings.engines['openai-compatible'], ...change },
		},
	}
}

describe('engine models', () => {
	describe('modelsChange', () => {
		it('sends only the changed models, an emptied one as null', () => {
			expect(
				modelsChange('gemini', { saved, values: { ...saved, fast: ' f-2 ', standard: '' } }),
			).toEqual({ engines: { gemini: { models: { fast: 'f-2', standard: null } } } })
		})

		it('sends nothing when nothing changed', () => {
			expect(modelsChange('gemini', { saved, values: { ...saved, fast: 'f-1 ' } })).toBeNull()
		})

		it('sends the endpoint of the OpenAI-compatible engine, an empty one as null', () => {
			expect(
				modelsChange('openai-compatible', {
					saved,
					values: { ...saved, baseUrl: 'http://127.0.0.1:9/v1' },
				}),
			).toEqual({ engines: { 'openai-compatible': { baseUrl: 'http://127.0.0.1:9/v1' } } })
			expect(
				modelsChange('openai-compatible', {
					saved: { ...saved, baseUrl: 'http://127.0.0.1:9/v1' },
					values: { ...saved, deep: 'd-1' },
				}),
			).toEqual({ engines: { 'openai-compatible': { baseUrl: null, models: { deep: 'd-1' } } } })
		})
	})

	describe('fieldIssues', () => {
		it('maps each issue path to its field', () => {
			expect(
				fieldIssues('openai-compatible', [
					'engines.openai-compatible.baseUrl: Use an http or https URL, or null',
					'engines.openai-compatible.models.deep: Use a model ID',
					'routing: Something else',
				]),
			).toEqual({ baseUrl: 'Use an http or https URL, or null', deep: 'Use a model ID' })
		})
	})

	describe('EngineModels', () => {
		let requests: SettingsFetch
		let toasts: SettingsToasts
		let models: EngineModels

		beforeEach(() => {
			requests = new SettingsFetch()
			toasts = new SettingsToasts()
			models = new EngineModels({
				engine: 'openai-compatible',
				initial: openAi({ baseUrl: null }).engines,
				api: createSettingsApi({ fetch: requests.fetch, signIn: mock<() => void>() }),
				toasts,
				strings: en.settings.errors,
			})
		})

		afterEach(() => {
			toasts.destroy()
		})

		it('saves the change with one PATCH and takes the answer', async () => {
			requests.answer(openAi({ baseUrl: 'http://127.0.0.1:9/v1' }))
			models.values = { ...models.values, baseUrl: 'http://127.0.0.1:9/v1' }

			expect(models.changed).toBe(true)

			await models.save()

			expect(requests.calls).toHaveLength(1)
			expect(models.saved.baseUrl).toBe('http://127.0.0.1:9/v1')
			expect(models.changed).toBe(false)
		})

		it('puts a refused value’s reason under its field', async () => {
			requests.refuse(400, 'invalid_body', {
				issues: ['engines.openai-compatible.baseUrl: Use an http or https URL, or null'],
			})
			models.values = { ...models.values, baseUrl: 'ftp://example.com' }

			await models.save()

			expect(models.errors).toEqual({ baseUrl: 'Use an http or https URL, or null' })
			expect(models.values.baseUrl).toBe('ftp://example.com')
		})

		it('shows a toast on any other failure', async () => {
			requests.fail()
			models.values = { ...models.values, fast: 'f-9' }

			await models.save()

			expect(toasts.current?.title).toBe('Could not save. Try again')
		})
	})
})
