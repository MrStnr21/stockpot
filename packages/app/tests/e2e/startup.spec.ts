// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { env, spawn } from 'bun'
import { dirname } from 'node:path'
import { expect, test } from '@playwright/test'

test.describe('server start', () => {
	test('stops with an error before any request when the environment is invalid', async () => {
		// The built server, as `bun run start` runs it; `bun run e2e` builds it first.
		const server = spawn(['bun', './dist/server/entry.mjs'], {
			cwd: dirname(test.info().config.configFile ?? ''),
			env: { PATH: env.PATH, PORT: '4401', STOCKPOT_PUBLIC_ORIGIN: 'not-an-origin' },
			stdout: 'ignore',
			stderr: 'pipe',
			// A server that keeps running is stopped here and fails the exit code check below.
			timeout: 10_000,
		})

		const stderr = await new Response(server.stderr).text()

		await server.exited

		expect(server.signalCode).toBeNull()
		expect(server.exitCode).toBe(1)
		expect(stderr).toContain('- STOCKPOT_PUBLIC_ORIGIN must be an http or https origin')
	})
})
