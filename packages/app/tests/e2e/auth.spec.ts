// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { $, env, spawn } from 'bun'
import { dirname } from 'node:path'
import { faker } from '@faker-js/faker'
import { expect, test } from '@playwright/test'

// A server of its own, on a fresh data directory, so the owner it creates is gone after the test.
const port = '4402'

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

test.describe('owner account', () => {
	test('sets up with the code from the server log, signs out and signs in again', async ({
		page,
	}) => {
		// `bun run e2e` builds the server first.
		const server = await startServer(test.info().config.configFile ?? '')
		const password = faker.internet.password({ length: 16 })

		try {
			await page.goto(`${origin}/`)
			await expect(page).toHaveURL(`${origin}/setup`)
			await page.getByLabel('Setup code').fill(server.code)
			await page.getByLabel('Password, at least 12 characters').fill(password)
			await page.getByLabel('The password again').fill(password)
			await page.getByRole('button', { name: 'Create the owner' }).click()
			await expect(page.getByText('Work in progress: nothing to capture yet.')).toBeVisible()

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
})
