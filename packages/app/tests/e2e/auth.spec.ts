// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { faker } from '@faker-js/faker'
import { expect, test } from '@playwright/test'
import * as v from 'valibot'

import { ownerServer } from './owner-server'

const { origin, startServer, createOwner } = ownerServer(2)

const createdDevice = v.object({
	device: v.object({ id: v.number() }),
	token: v.string(),
})

test.describe('owner account', () => {
	test('sets up with the code from the server log, signs out and signs in again', async ({
		page,
	}) => {
		// `bun run e2e` builds the server first.
		const server = await startServer(test.info().config.configFile ?? '')
		const password = faker.internet.password({ length: 16 })

		try {
			await createOwner(page, server.code, password)

			await page.goto(`${origin}/settings/account`)
			await page.getByRole('button', { name: 'Sign out' }).click()
			await expect(page).toHaveURL(`${origin}/signin`)

			await page.getByLabel('Password').fill(password)
			await page.getByRole('button', { name: 'Sign in' }).click()
			await expect(page).toHaveURL(`${origin}/`)
			await expect(page.getByRole('heading', { level: 1, name: 'Today' })).toBeVisible()
		} finally {
			await server.stop()
		}
	})

	test('creates a device token that signs in until it is revoked', async ({ page, playwright }) => {
		const server = await startServer(test.info().config.configFile ?? '')
		// The web app's own requests carry the session cookie and its origin.
		const webApp = { headers: { origin } }

		try {
			await createOwner(page, server.code, faker.internet.password({ length: 16 }))

			const created = await page.request.post(`${origin}/api/devices`, {
				...webApp,
				data: { name: 'iPhone Shortcut' },
			})

			expect(created.status()).toBe(201)

			const { device, token } = v.parse(createdDevice, await created.json())

			const shortcut = await playwright.request.newContext({
				extraHTTPHeaders: { authorization: `Bearer ${token}` },
			})

			// 403, not 401: the token signs the device in, but devices are managed from the web only.
			const signedInByDevice = await shortcut.get(`${origin}/api/devices`)

			expect(signedInByDevice.status()).toBe(403)

			const revoked = await page.request.delete(`${origin}/api/devices/${device.id}`, webApp)

			expect(revoked.status()).toBe(204)

			const afterRevoking = await shortcut.get(`${origin}/api/devices`)

			expect(afterRevoking.status()).toBe(401)
			await shortcut.dispose()
		} finally {
			await server.stop()
		}
	})
})
