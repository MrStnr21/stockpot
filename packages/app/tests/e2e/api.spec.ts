// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { expect, test } from '@playwright/test'

test.describe('API errors', () => {
	test('answers an unknown API path with a JSON 404', async ({ request }) => {
		const response = await request.get('/api/no-such-route')

		expect(response.status()).toBe(404)
		expect(await response.json()).toEqual({
			error: { code: 'not_found', message: 'There is no such API route.' },
		})
	})
})
