// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

/*
 * The route check over the real pages. It sits in src/pages/ because only entry code may load page
 * modules (docs/architecture.md, "Dependency rules"); the leading underscore keeps Astro from serving
 * it as an endpoint. undeclaredHandlers itself is specced against fixtures in src/server/http.spec.ts.
 */
import { Glob } from 'bun'
import { describe, expect, it } from 'bun:test'
import { join } from 'node:path'

import { undeclaredHandlers, type RouteModule } from '#/server/http'

/** Endpoint files Astro serves: TypeScript or JavaScript, no spec, nothing under a leading `_`. */
function isEndpoint(file: string) {
	return !file.endsWith('.spec.ts') && !file.split('/').some((part) => part.startsWith('_'))
}

async function undeclaredRoutes() {
	const files = await Array.fromAsync(new Glob('**/*.{ts,js}').scan(import.meta.dir))

	const findings = await Promise.all(
		files
			.filter((file) => isEndpoint(file))
			.map(async (file) => {
				// oxlint-disable-next-line typescript/no-unsafe-assignment -- import() of a computed path is typed any; Astro reads these exports as handlers.
				const module: RouteModule = await import(join(import.meta.dir, file))

				return undeclaredHandlers(module).map((method) => `${method} in src/pages/${file}`)
			}),
	)

	return findings.flat()
}

describe('API routes', () => {
	it('declare their access with route.public or route.authorized', async () => {
		expect(await undeclaredRoutes()).toEqual([])
	})
})
