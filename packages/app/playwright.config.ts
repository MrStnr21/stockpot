// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { env } from 'bun'
import { defineConfig, devices } from '@playwright/test'

const port = env.E2E_PORT ?? '4400'

const baseURL = `http://127.0.0.1:${port}`

// `bun run e2e` builds first; the suite runs against the production server, not the dev server.
export default defineConfig({
	testDir: './tests/e2e',
	forbidOnly: env.CI !== undefined,
	reporter: [['list'], ['html', { open: 'never' }]],
	use: { baseURL, trace: 'retain-on-failure', ...devices['Desktop Chrome'] },
	webServer: {
		command: 'bun ./dist/server/entry.mjs',
		url: baseURL,
		reuseExistingServer: false,
		stdout: 'pipe',
		stderr: 'pipe',
		timeout: 30_000,
		env: { HOST: '127.0.0.1', PORT: port, STOCKPOT_PUBLIC_ORIGIN: baseURL },
	},
})
