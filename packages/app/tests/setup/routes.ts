// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { Glob } from 'bun'
import { join } from 'node:path'
import * as v from 'valibot'

import { routeModuleSchema, undeclaredHandlers } from '#/server/http'

/** Whether Astro serves the file: it skips any path with a segment that starts with `_`. */
function isServed(file: string) {
	return !file.split('/').some((segment) => segment.startsWith('_'))
}

/**
 * The route check: every problem in the endpoints under a pages folder, one line each. Dot folders
 * such as `.well-known` are scanned too, since Astro serves them, and so is a spec that does not
 * start with `_`, which Astro would serve as a route with `bun:test` in it.
 */
export async function routeProblems(pagesFolder: string): Promise<string[]> {
	const files = await Array.fromAsync(
		new Glob('**/*.{ts,js}').scan({ cwd: pagesFolder, dot: true }),
	)

	const problems = await Promise.all(
		files
			.filter((file) => isServed(file))
			.toSorted()
			.map(async (file) => {
				if (file.endsWith('.spec.ts')) {
					return [`${file}: a spec in src/pages must start with _, or Astro serves it as a route`]
				}

				const module: unknown = await import(join(pagesFolder, file))
				const exports = v.parse(routeModuleSchema, module)

				const undeclared = undeclaredHandlers(exports).map(
					(method) => `${file}: ${method} has no route.public, route.authorized or route.session`,
				)

				// ALL also answers GET, which the cross-site check lets through, so each method is its own export.
				const catchAll =
					exports.ALL === undefined
						? []
						: [`${file}: ALL is not allowed; export one handler per method`]

				return [undeclared, catchAll].flat()
			}),
	)

	return problems.flat()
}
