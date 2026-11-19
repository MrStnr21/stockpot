// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { expect, test } from '@playwright/test'

test.describe('health and metrics', () => {
	test('reports the database and the job runner that the server started', async ({ request }) => {
		const response = await request.get('/healthz')

		expect(response.status()).toBe(200)
		expect(await response.json()).toMatchObject({ database: 'ok', runner: 'ok' })
	})

	test('hides /metrics while no token is set', async ({ request }) => {
		const response = await request.get('/metrics')

		expect(response.status()).toBe(404)
	})
})
