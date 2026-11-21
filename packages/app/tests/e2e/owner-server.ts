// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { $, env, spawn } from 'bun'
import { dirname } from 'node:path'
import { expect, type Page } from '@playwright/test'

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

interface OwnerServer {
	readonly origin: string
	readonly startServer: (
		configFile: string,
		environment?: Record<string, string>,
	) => Promise<{ code: string; stop: () => Promise<void> }>
	readonly createOwner: (page: Page, code: string, password: string) => Promise<void>
}

/*
 * A server of its own, on a fresh data directory, so the owner it creates is gone after the spec.
 * Its port is the shared server's (playwright.config.ts) plus `offset`, so setting E2E_PORT moves
 * both; every spec file that starts one takes an offset no other uses.
 */
export function ownerServer(offset: number): OwnerServer {
	const port = String(Number(env.E2E_PORT ?? '4400') + offset)

	const origin = `http://127.0.0.1:${port}`

	/** Starts the built server, as `bun run start` runs it, on an empty data directory. */
	async function startServer(configFile: string, environment: Record<string, string> = {}) {
		const created = await $`mktemp -d`.text()
		const directory = created.trim()

		const server = spawn(['bun', './dist/server/entry.mjs'], {
			cwd: dirname(configFile),
			env: {
				...environment,
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

	/** Claims the instance on its setup page and lands on Today, signed in. */
	async function createOwner(page: Page, code: string, password: string) {
		await page.goto(`${origin}/`)
		await expect(page).toHaveURL(`${origin}/setup`)
		await page.getByLabel('Setup code').fill(code)
		await page.getByLabel('Password, at least 12 characters').fill(password)
		await page.getByLabel('The password again').fill(password)
		await page.getByRole('button', { name: 'Create the owner' }).click()
		await expect(page.getByRole('heading', { level: 1, name: 'Today' })).toBeVisible()
	}

	return { origin, startServer, createOwner }
}
