#!/usr/bin/env bun
// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

/*
 * `bun run check:license`: fails when a source file lacks the SPDX header. Checks tracked files and new
 * files git does not ignore, so a missing header shows up before the commit, not in CI.
 */
import { $, file } from 'bun'

import { hasHeader, needsHeader } from './headers.ts'

const root = new URL('../../', import.meta.url).pathname

const listing = await $`git ls-files --cached --others --exclude-standard`.cwd(root).text()

const sources = listing.split('\n').filter((path) => path !== '' && needsHeader(path))

const missing: string[] = []

for (const path of sources) {
	const source = file(`${root}${path}`)

	// A file deleted in the working tree but still in the index has nothing to check.
	// oxlint-disable-next-line eslint/no-await-in-loop -- A few dozen small files; order keeps the report stable.
	if ((await source.exists()) && !hasHeader(await source.text())) {
		missing.push(path)
	}
}

if (missing.length > 0) {
	console.error(`Missing the SPDX header (see docs/guidelines/code.md):\n  ${missing.join('\n  ')}`)
	process.exit(1)
}

console.log(`SPDX headers present in ${sources.length} source files.`)
