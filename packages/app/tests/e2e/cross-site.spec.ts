// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { expect, test } from '@playwright/test'

// Playwright's request client sends no Sec-Fetch-Site, so these exercise the Origin check.
test.describe('cross-site requests', () => {
	test('refuses a form post from another site', async ({ request }) => {
		const response = await request.post('/', {
			headers: { origin: 'https://evil.example' },
			form: { note: 'Bun' },
		})

		expect(response.status()).toBe(403)
		expect(await response.json()).toEqual({
			error: { code: 'cross_site', message: 'Requests from another site are refused.' },
		})
	})

	test('lets a form post from the public origin through', async ({ request }) => {
		const response = await request.post('/', {
			headers: { origin: String(test.info().project.use.baseURL) },
			form: { note: 'Bun' },
		})

		expect(response.status()).toBe(200)
	})
})
