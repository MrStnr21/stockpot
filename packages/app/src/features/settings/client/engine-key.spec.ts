// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { faker } from '@faker-js/faker'
import { publicSettingsFactory } from '#tests/factories/settings'
import { SettingsFetch } from '#tests/setup/settings-fetch'

import { en } from '#/lib/i18n/en'

import type { EngineTestResult, PublicSettings } from '../shared/types'
import { EngineKey } from './engine-key.svelte'
import { EngineTester } from './engine-tester.svelte'
import { createSettingsApi } from './settings-api'
import { SettingsToasts } from './settings-toasts.svelte'

function withOpenAiKey(apiKey: 'set' | 'not set'): PublicSettings {
	const settings = publicSettingsFactory.build()

	return {
		...settings,
		engines: {
			...settings.engines,
			'openai-compatible': { ...settings.engines['openai-compatible'], apiKey },
		},
	}
}

const rejected: EngineTestResult = {
	engine: 'openai-compatible',
	testedAt: '2026-11-20T08:00:00.000Z',
	outcome: 'auth',
}

describe('EngineKey', () => {
	let requests: SettingsFetch
	let toasts: SettingsToasts
	let tester: EngineTester
	let onsaved: ReturnType<typeof mock<(settings: PublicSettings) => void>>
	let key: EngineKey
	let typed: string

	beforeEach(() => {
		requests = new SettingsFetch()
		toasts = new SettingsToasts()

		const api = createSettingsApi({ fetch: requests.fetch, signIn: mock<() => void>() })

		tester = new EngineTester({ api })
		onsaved = mock<(settings: PublicSettings) => void>()
		key = new EngineKey({
			engine: 'openai-compatible',
			initial: 'not set',
			api,
			tester,
			toasts,
			strings: en.settings,
			onsaved,
		})
		typed = `sk-${faker.string.alphanumeric(40)}`
		key.start()
		key.value = `  ${typed}  `
	})

	afterEach(() => {
		toasts.destroy()
	})

	it('sends the trimmed key, empties the field, then tests the engine', async () => {
		requests.answer(withOpenAiKey('set')).answer(rejected)

		await key.save()

		expect(requests.calls).toEqual([
			{
				url: '/api/settings',
				method: 'PATCH',
				body: { engines: { 'openai-compatible': { apiKey: typed } } },
			},
			{ url: '/api/engines/openai-compatible/test', method: 'POST', body: null },
		])
		expect(key.value).toBe('')
		expect(key.state).toBe('set')
		expect(key.editing).toBe(false)
		expect(key.tested).toBe(true)
		expect(tester.slot('openai-compatible').result).toEqual(rejected)
		expect(onsaved).toHaveBeenCalledTimes(1)
	})

	it('empties the field before the answer arrives', async () => {
		requests.answer(withOpenAiKey('set')).answer(rejected)

		const saving = key.save()

		expect(key.value).toBe('')
		expect(key.saving).toBe(true)

		await saving
	})

	it('empties the field after a failure and does not test', async () => {
		requests.refuse(400, 'invalid_body', {
			issues: ['engines.openai-compatible.apiKey: Use a key of 1 to 4096 characters, or null'],
		})

		await key.save()

		expect(key.value).toBe('')
		expect(key.state).toBe('not set')
		expect(key.editing).toBe(true)
		expect(key.error).toBe('Use a key of 1 to 4096 characters, or null')
		expect(requests.calls).toHaveLength(1)
	})

	it('shows a toast without the key when the save fails', async () => {
		requests.fail()

		await key.save()

		expect(key.value).toBe('')
		expect(toasts.current?.title).toBe('Could not save. Try again')
		expect(JSON.stringify(toasts.current)).not.toContain(typed)
	})

	it('sends nothing for an empty field', async () => {
		key.value = '   '

		expect(key.canSave).toBe(false)

		await key.save()

		expect(requests.calls).toEqual([])
	})

	it('says when the test after the save could not run', async () => {
		requests.answer(withOpenAiKey('set')).refuse(409, 'test_running')

		await key.save()

		expect(key.state).toBe('set')
		expect(toasts.current?.title).toBe('A test is already running')
	})

	it('drops the typed key on Cancel', () => {
		key.cancel()

		expect(key.value).toBe('')
		expect(key.editing).toBe(false)
	})

	it('clears the saved key with null after the confirm', async () => {
		requests.answer(withOpenAiKey('not set'))
		key.askClear()

		await key.clear()

		expect(requests.calls).toEqual([
			{
				url: '/api/settings',
				method: 'PATCH',
				body: { engines: { 'openai-compatible': { apiKey: null } } },
			},
		])
		expect(key.state).toBe('not set')
		expect(key.confirmingClear).toBe(false)
	})
})
