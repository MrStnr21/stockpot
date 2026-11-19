// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

/*
 * The route check over the real pages; the leading underscore keeps Astro from serving this file.
 * routeProblems is specced against fixtures in tests/setup/routes.spec.ts.
 */
import { describe, expect, it } from 'bun:test'
import { routeProblems } from '#tests/setup/routes'

describe('API routes', () => {
	it('declare their access with route.public, route.authorized or route.session', async () => {
		expect(await routeProblems(import.meta.dir)).toEqual([])
	})
})
