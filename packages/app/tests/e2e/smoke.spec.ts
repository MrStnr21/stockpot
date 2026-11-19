// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { expect, test } from '@playwright/test'

test.describe('home page', () => {
	test('sends a visitor to setup while the instance has no owner', async ({ page }) => {
		const response = await page.goto('/')

		expect(response?.status()).toBe(200)
		await expect(page).toHaveURL(/\/setup$/u)
		await expect(page).toHaveTitle('Set up stockpot')
		await expect(page.getByRole('heading', { name: 'Set up your instance' })).toBeVisible()
	})
})
