// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { expect, test } from '@playwright/test'

test.describe('home page', () => {
	test('serves the placeholder', async ({ page }) => {
		const response = await page.goto('/')

		expect(response?.status()).toBe(200)
		await expect(page).toHaveTitle('stockpot')
		await expect(page.getByText('Toss in the scraps of your day. Wake up to broth.')).toBeVisible()
	})
})
