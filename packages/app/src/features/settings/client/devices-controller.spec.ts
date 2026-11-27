// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { faker } from '@faker-js/faker'
import { SettingsFetch } from '#tests/setup/settings-fetch'

import { en } from '#/lib/i18n/en'

import type { DeviceRow } from '../shared/types'
import { deviceIcon, DevicesList, deviceSubtitle, NewDevice } from './devices-controller.svelte'
import { createSettingsApi } from './settings-api'
import { SettingsToasts } from './settings-toasts.svelte'

function device(change: Partial<DeviceRow> = {}): DeviceRow {
	return {
		id: faker.number.int({ min: 1, max: 1000 }),
		name: faker.commerce.productName(),
		hint: `sp1_…${faker.string.alphanumeric(4)}`,
		createdAt: '2026-11-19T08:00:00.000Z',
		lastUsedAt: null,
		...change,
	}
}

describe('devices', () => {
	let requests: SettingsFetch
	let toasts: SettingsToasts

	beforeEach(() => {
		requests = new SettingsFetch()
		toasts = new SettingsToasts()
	})

	afterEach(() => {
		toasts.destroy()
	})

	function api() {
		return createSettingsApi({ fetch: requests.fetch, signIn: mock<() => void>() })
	}

	describe('deviceIcon and deviceSubtitle', () => {
		it('draws a laptop for a Mac, whatever the case, and a phone otherwise', () => {
			expect(deviceIcon('Mac · MCP client')).toBe('laptop')
			expect(deviceIcon('my macbook')).toBe('laptop')
			expect(deviceIcon('iPhone · Shortcut')).toBe('phone')
		})

		it('says when the device was last used, or that it never was', () => {
			const options = {
				now: new Date('2026-11-20T10:00:00.000Z'),
				locale: 'en',
				timeZone: 'Europe/Berlin',
				strings: en.settings,
			}

			expect(
				deviceSubtitle({ lastUsedAt: '2026-11-20T09:58:00.000Z', hint: 'sp1_…x7Qa' }, options),
			).toBe('Last used 2 min ago · sp1_…x7Qa')
			expect(deviceSubtitle({ lastUsedAt: null, hint: 'sp1_…x7Qa' }, options)).toBe(
				'Never used · sp1_…x7Qa',
			)
		})
	})

	describe('DevicesList', () => {
		let first: DeviceRow
		let second: DeviceRow
		let list: DevicesList

		beforeEach(() => {
			first = device({ id: 1 })
			second = device({ id: 2 })
			list = new DevicesList({
				initial: [first, second],
				api: api(),
				toasts,
				strings: en.settings.errors,
			})
		})

		it('revokes only after the confirm, then drops the row', async () => {
			list.askRevoke(second)

			expect(requests.calls).toEqual([])
			expect(list.revoking).toEqual(second)

			requests.empty()
			await list.confirmRevoke()

			expect(requests.calls).toEqual([{ url: '/api/devices/2', method: 'DELETE', body: null }])
			expect(list.devices).toEqual([first])
			expect(list.revoking).toBeNull()
		})

		it('sends nothing when the confirm is cancelled', async () => {
			list.askRevoke(first)
			list.cancelRevoke()
			await list.confirmRevoke()

			expect(requests.calls).toEqual([])
			expect(list.devices).toEqual([first, second])
		})

		it('drops a row that is gone already', async () => {
			requests.refuse(404, 'not_found')
			list.askRevoke(first)

			await list.confirmRevoke()

			expect(list.devices).toEqual([second])
		})

		it('keeps the row and shows a toast when the revoke fails', async () => {
			requests.fail()
			list.askRevoke(first)

			await list.confirmRevoke()

			expect(list.devices).toEqual([first, second])
			expect(toasts.current?.title).toBe('Could not revoke. Try again')
		})
	})

	describe('NewDevice', () => {
		let added: NewDevice
		let token: string

		beforeEach(() => {
			added = new NewDevice({ api: api(), toasts, strings: en.settings.errors })
			token = `sp1_${faker.string.alphanumeric(43)}`
		})

		function answerCreated(name: string) {
			requests.answer({ device: device({ name, hint: `sp1_…${token.slice(-4)}` }), token }, 201)
		}

		it('creates the device with the trimmed name and keeps its token until Done', async () => {
			answerCreated('Mac · MCP client')
			added.name = '  Mac · MCP client '

			await added.create()

			expect(requests.calls).toEqual([
				{ url: '/api/devices', method: 'POST', body: { name: 'Mac · MCP client' } },
			])
			expect(added.token).toBe(token)
			expect(added.canCreate).toBe(false)

			added.done()

			expect(added.token).toBeNull()
			expect(added.name).toBe('')
		})

		it('copies the token and says so', async () => {
			answerCreated('iPhone')
			added.name = 'iPhone'
			await added.create()

			const copied: string[] = []

			await added.copy({
				writeText: async (text) => {
					copied.push(text)
				},
			})

			expect(copied).toEqual([token])
			expect(added.copied).toBe(true)
		})

		it('says a refused copy without the token', async () => {
			answerCreated('iPhone')
			added.name = 'iPhone'
			await added.create()

			await added.copy({
				writeText: async () => {
					throw new Error('Denied')
				},
			})

			expect(added.copied).toBe(false)
			expect(toasts.current?.title).toBe('Could not copy. Select the token and copy it')
			expect(JSON.stringify(toasts.current)).not.toContain(token)
		})

		it('shows the server’s reason under the name on a 400', async () => {
			requests.refuse(400, 'invalid_body', { issues: ['name: Use at most 100 characters.'] })
			added.name = 'x'

			await added.create()

			expect(added.error).toBe('Use at most 100 characters.')
			expect(added.token).toBeNull()
		})

		it('sends nothing without a name', async () => {
			added.name = '  '

			await added.create()

			expect(requests.calls).toEqual([])
		})
	})
})
