// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { env } from 'bun'
import { defineConfig, devices } from '@playwright/test'

const port = Number(env.BOOK_PORT ?? 4410)

const baseURL = `http://127.0.0.1:${port}`

export default defineConfig({
	testDir: './tests/book',
	fullyParallel: true,
	forbidOnly: env.CI !== undefined,
	reporter: [['list'], ['html', { open: 'never' }]],
	use: { ...devices['Desktop Chrome'], baseURL, trace: 'retain-on-failure' },
	projects: [
		{ name: '390×844', use: { viewport: { width: 390, height: 844 } } },
		{ name: '1440×900', use: { viewport: { width: 1440, height: 900 } } },
	],
	webServer: {
		/* Astro 7 moves `astro preview` into the background when it sees CI or no terminal, and Playwright
		 * then loses the server; `--ignore-lock` keeps it in the foreground (checked on 7.4.12). */
		command: `bunx --bun astro preview --host 127.0.0.1 --port ${port} --ignore-lock`,
		url: baseURL,
		reuseExistingServer: false,
		stdout: 'pipe',
		stderr: 'pipe',
	},
})
