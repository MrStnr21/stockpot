#!/usr/bin/env bun
// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

/*
 * `bun run notices` writes THIRD_PARTY_NOTICES.md from the run-time dependencies of the shipped
 * workspaces and the fonts vendored in packages/ui; `bun run notices -- --check` fails when the
 * committed file is stale. Both fail when a licence is not compatible with AGPL-3.0-or-later
 * (tools/notices/licenses.ts) or a font file differs from the SHA-256 recorded in its font.json.
 */
import { argv, file, write } from 'bun'

import { collectDependencies, collectFonts } from './collect.ts'
import { isCompatible } from './licenses.ts'
import { renderNotices } from './render.ts'

const root = new URL('../../', import.meta.url).pathname

const output = `${root}THIRD_PARTY_NOTICES.md`

const dependencies = await collectDependencies(root, [`${root}packages/app`, `${root}packages/ui`])

const fonts = await collectFonts(`${root}packages/ui/src/fonts`)

const incompatible = [...dependencies, ...fonts].filter(({ license }) => !isCompatible(license))

if (incompatible.length > 0) {
	const list = incompatible.map(({ name, version, license }) => `${name}@${version} (${license})`)

	console.error(`Licences not compatible with AGPL-3.0-or-later:\n  ${list.join('\n  ')}`)
	process.exit(1)
}

const notices = renderNotices(dependencies, fonts)

if (argv.includes('--check')) {
	const committed = file(output)

	if (!(await committed.exists()) || (await committed.text()) !== notices) {
		console.error('THIRD_PARTY_NOTICES.md is stale. Run: bun run notices')
		process.exit(1)
	}

	console.log(`THIRD_PARTY_NOTICES.md is up to date (${dependencies.length} packages).`)
} else {
	await write(output, notices)
	console.log(`Wrote THIRD_PARTY_NOTICES.md (${dependencies.length} packages).`)
}
