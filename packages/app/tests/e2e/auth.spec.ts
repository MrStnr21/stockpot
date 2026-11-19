// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { $, env, spawn } from 'bun'
import { dirname } from 'node:path'
import { faker } from '@faker-js/faker'
import { expect, test, type Page } from '@playwright/test'
import * as v from 'valibot'

/* A server of its own, on a fresh data directory, so the owner it creates is gone after the test. Its
 * port is derived from the shared server's (playwright.config.ts), so setting E2E_PORT moves both. */
const port = String(Number(env.E2E_PORT ?? '4400') + 2)

const origin = `http://127.0.0.1:${port}`

/** Resolves with the setup code once the server has printed it and listens; keeps reading after. */
async function readSetupCode(stdout: ReadableStream<Uint8Array>) {
	const { promise, resolve, reject } = Promise.withResolvers<string>()
	const decoder = new TextDecoder()
	let log = ''

	async function drain() {
		for await (const chunk of stdout) {
			log += decoder.decode(chunk, { stream: true })

			const code = /setup code (?<code>[\dA-Z-]{19})/u.exec(log)?.groups?.code

			if (code !== undefined && log.includes('Server listening')) {
				resolve(code)
			}
		}

		reject(new Error(`The server stopped without printing a setup code:\n${log}`))
	}

	drain().catch(reject)

	return promise
}

/** Starts the built server, as `bun run start` runs it, on an empty data directory. */
async function startServer(configFile: string) {
	const created = await $`mktemp -d`.text()
	const directory = created.trim()

	const server = spawn(['bun', './dist/server/entry.mjs'], {
		cwd: dirname(configFile),
		env: {
			PATH: env.PATH,
			HOST: '127.0.0.1',
			PORT: port,
			STOCKPOT_PUBLIC_ORIGIN: origin,
			STOCKPOT_DATA_DIR: directory,
		},
		stdout: 'pipe',
		stderr: 'inherit',
	})

	async function stop() {
		server.kill()
		await server.exited
		await $`rm -rf ${directory}`
	}

	return { code: await readSetupCode(server.stdout), stop }
}

/** Claims the instance on its setup page and lands on the home page, signed in. */
async function createOwner(page: Page, code: string, password: string) {
	await page.goto(`${origin}/`)
	await expect(page).toHaveURL(`${origin}/setup`)
	await page.getByLabel('Setup code').fill(code)
	await page.getByLabel('Password, at least 12 characters').fill(password)
	await page.getByLabel('The password again').fill(password)
	await page.getByRole('button', { name: 'Create the owner' }).click()
	await expect(page.getByText('Work in progress: nothing to capture yet.')).toBeVisible()
}

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

			await page.getByRole('button', { name: 'Sign out' }).click()
			await expect(page).toHaveURL(`${origin}/signin`)

			await page.getByLabel('Password').fill(password)
			await page.getByRole('button', { name: 'Sign in' }).click()
			await expect(page).toHaveURL(`${origin}/`)
			await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible()
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
