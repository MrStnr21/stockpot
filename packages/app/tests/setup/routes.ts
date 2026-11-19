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
 * such as `.well-known` are scanned too, since Astro serves them.
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
				const module: unknown = await import(join(pagesFolder, file))
				const exports = v.parse(routeModuleSchema, module)

				return undeclaredHandlers(exports).map(
					(method) => `${file}: ${method} has no route.public or route.authorized`,
				)
			}),
	)

	return problems.flat()
}
