// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { $, write } from 'bun'
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { join } from 'node:path'

import { routeProblems } from './routes'

// Fixtures live in a temporary folder, so they import the route helpers by absolute path.
const http = JSON.stringify(join(import.meta.dir, '../../src/server/http.ts'))

const declared = `import { route } from ${http}
export const GET = route.authorized(() => new Response())
export const POST = route.public(() => new Response())
`

const bare = 'export const GET = () => new Response()\n'

const fixtures = {
	'api/notes.ts': declared,
	'.well-known/security.ts': bare,
	'_lib/helper.ts': bare,
	'api/_draft/index.ts': bare,
}

describe('routeProblems', () => {
	let pagesFolder: string

	beforeAll(async () => {
		const created = await $`mktemp -d`.text()

		pagesFolder = created.trim()

		await Promise.all(
			Object.entries(fixtures).map(async ([file, source]) =>
				write(join(pagesFolder, file), source),
			),
		)
	})

	afterAll(async () => {
		await $`rm -rf ${pagesFolder}`
	})

	it('reports bare handlers, dot folders included, and skips what Astro does not serve', async () => {
		expect(await routeProblems(pagesFolder)).toEqual([
			'.well-known/security.ts: GET has no route.public or route.authorized',
		])
	})
})
