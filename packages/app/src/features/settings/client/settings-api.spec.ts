// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { beforeEach, describe, expect, it, mock } from 'bun:test'
import { faker } from '@faker-js/faker'
import { publicSettingsFactory } from '#tests/factories/settings'
import { SettingsFetch } from '#tests/setup/settings-fetch'

import { createSettingsApi, type SettingsApi } from './settings-api'

const isoNow = '2026-03-15T09:00:00.000Z'

describe('createSettingsApi', () => {
	let requests: SettingsFetch
	let signIn: ReturnType<typeof mock<() => void>>
	let api: SettingsApi

	beforeEach(() => {
		requests = new SettingsFetch()
		signIn = mock<() => void>()
		api = createSettingsApi({ fetch: requests.fetch, signIn })
	})

	describe('patchSettings', () => {
		it('sends the change and answers the settings after it', async () => {
			const settings = publicSettingsFactory.build()
			requests.answer(settings)

			expect(await api.patchSettings({ digest: { limit: 6 } })).toEqual({
				ok: true,
				value: settings,
			})
			expect(requests.call(0)).toEqual({
				url: '/api/settings',
				method: 'PATCH',
				body: { digest: { limit: 6 } },
			})
		})

		it('passes on the issues of a 400', async () => {
			requests.refuse(400, 'invalid_body', { issues: ['digest.time: Use HH:MM'] })

			expect(await api.patchSettings({ digest: { time: '24:00' } })).toEqual({
				ok: false,
				status: 400,
				code: 'invalid_body',
				issues: ['digest.time: Use HH:MM'],
			})
		})

		it('refuses an answer that is not settings', async () => {
			requests.answer({ devices: [] })

			expect(await api.patchSettings({ cardLanguage: 'de' })).toEqual({
				ok: false,
				status: 200,
				code: 'unreadable',
			})
		})
	})

	describe('on a 401', () => {
		it('sends the owner to sign in', async () => {
			requests.refuse(401, 'unauthorized')

			expect(await api.listDevices()).toEqual({ ok: false, status: 401, code: 'unauthorized' })
			expect(signIn).toHaveBeenCalledTimes(1)
		})
	})

	describe('on a network failure', () => {
		it('answers status 0', async () => {
			requests.fail()

			expect(await api.reorderCategories([2, 1])).toEqual({
				ok: false,
				status: 0,
				code: 'network',
			})
			expect(signIn).not.toHaveBeenCalled()
		})
	})

	describe('testEngine', () => {
		it('posts to the engine and answers the result', async () => {
			const result = {
				engine: 'agent-command',
				testedAt: isoNow,
				outcome: 'ok',
				elapsedMs: 812,
				model: null,
			} as const

			requests.answer(result)

			expect(await api.testEngine('agent-command')).toEqual({ ok: true, value: result })
			expect(requests.call(0)).toMatchObject({
				url: '/api/engines/agent-command/test',
				method: 'POST',
			})
		})

		it('reads a rate limit with its reset time', async () => {
			const result = {
				engine: 'gemini',
				testedAt: isoNow,
				outcome: 'rate_limited',
				resetsAt: '2026-03-15T10:00:00.000Z',
			} as const

			requests.answer(result)

			expect(await api.testEngine('gemini')).toEqual({ ok: true, value: result })
		})

		it('passes on the seconds of a 429', async () => {
			requests.answer({ error: { code: 'too_soon', message: 'Wait.' } }, 429, {
				'retry-after': '7',
			})

			expect(await api.testEngine('gemini')).toEqual({
				ok: false,
				status: 429,
				code: 'too_soon',
				retryAfter: 7,
			})
		})

		it('passes on a 409', async () => {
			requests.refuse(409, 'test_running')

			expect(await api.testEngine('gemini')).toMatchObject({ status: 409, code: 'test_running' })
		})
	})

	describe('devices', () => {
		const device = {
			id: 4,
			name: 'Mac · MCP client',
			hint: 'sp1_…x7Qa',
			createdAt: isoNow,
			lastUsedAt: null,
		}

		it('lists them', async () => {
			requests.answer({ devices: [device] })

			expect(await api.listDevices()).toEqual({ ok: true, value: [device] })
			expect(requests.call(0)).toMatchObject({ url: '/api/devices', method: 'GET' })
		})

		it('creates one and answers its token', async () => {
			const token = `sp1_${faker.string.alphanumeric(43)}`
			requests.answer({ device, token }, 201)

			expect(await api.createDevice(device.name)).toEqual({ ok: true, value: { device, token } })
			expect(requests.call(0)).toEqual({
				url: '/api/devices',
				method: 'POST',
				body: { name: device.name },
			})
		})

		it('revokes one', async () => {
			requests.empty()

			expect(await api.revokeDevice(4)).toEqual({ ok: true, value: null })
			expect(requests.call(0)).toMatchObject({ url: '/api/devices/4', method: 'DELETE' })
		})
	})

	describe('categories', () => {
		const record = {
			id: 7,
			name: 'Cooking',
			icon: 'leaf',
			color: 'concept',
			format: 'brief',
			instructions: '',
			position: 6,
		}

		it('creates one', async () => {
			requests.answer(record, 201)
			const { id: _id, position: _position, ...fields } = record

			expect(await api.createCategory(fields)).toEqual({ ok: true, value: record })
			expect(requests.call(0)).toEqual({ url: '/api/categories', method: 'POST', body: fields })
		})

		it('sends only the change', async () => {
			requests.answer(record)

			await api.changeCategory(7, { name: 'Cooking' })

			expect(requests.call(0)).toEqual({
				url: '/api/categories/7',
				method: 'PATCH',
				body: { name: 'Cooking' },
			})
		})

		it('passes on the name conflict', async () => {
			requests.refuse(409, 'category_exists')

			expect(await api.changeCategory(7, { name: 'Cooking' })).toMatchObject({
				ok: false,
				status: 409,
				code: 'category_exists',
			})
		})

		it('deletes one, moving its notes', async () => {
			await api.deleteCategory(7, 2)

			expect(requests.call(0)).toMatchObject({
				url: '/api/categories/7?moveTo=2',
				method: 'DELETE',
			})
		})

		it('deletes one without notes', async () => {
			await api.deleteCategory(7)

			expect(requests.call(0).url).toBe('/api/categories/7')
		})

		it('passes on the count of notes that still use it', async () => {
			requests.refuse(409, 'category_in_use', { notes: 3 })

			expect(await api.deleteCategory(7)).toEqual({
				ok: false,
				status: 409,
				code: 'category_in_use',
				notes: 3,
			})
		})

		it('saves the order', async () => {
			expect(await api.reorderCategories([3, 1, 2])).toEqual({ ok: true, value: null })
			expect(requests.call(0)).toEqual({
				url: '/api/categories/order',
				method: 'PUT',
				body: { ids: [3, 1, 2] },
			})
		})

		it('sets and clears the engine', async () => {
			await api.setCategoryEngine(7, 'gemini')
			await api.setCategoryEngine(7, null)

			expect(requests.calls).toEqual([
				{ url: '/api/categories/7/engine', method: 'PUT', body: { engine: 'gemini' } },
				{ url: '/api/categories/7/engine', method: 'PUT', body: { engine: null } },
			])
		})
	})
})
