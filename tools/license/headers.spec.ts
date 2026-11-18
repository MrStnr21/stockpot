// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { describe, expect, it } from 'bun:test'

import { hasHeader, needsHeader } from './headers'

const header = [
	'// SPDX-License-Identifier: AGPL-3.0-or-later',
	'// SPDX-FileCopyrightText: 2026 The stockpot authors',
].join('\n')

describe('headers', () => {
	describe('needsHeader', () => {
		it.each(['src/pages/index.astro', 'lefthook.yml', 'bunfig.toml', 'src/main.css', 'a/b.svelte'])(
			'requires a header in %s',
			(path) => {
				expect(needsHeader(path)).toBe(true)
			},
		)

		it.each(['package.json', 'README.md', 'LICENSE', 'bun.lock', '.gitignore'])(
			'skips %s',
			(path) => {
				expect(needsHeader(path)).toBe(false)
			},
		)
	})

	describe('hasHeader', () => {
		it('accepts the two lines at the top', () => {
			expect(hasHeader(`${header}\n\nexport {}\n`)).toBe(true)
		})

		it('accepts them after a shebang or a frontmatter fence', () => {
			expect(hasHeader(`#!/usr/bin/env bun\n${header}\n`)).toBe(true)
			expect(hasHeader(`---\n${header}\n---\n`)).toBe(true)
		})

		it('accepts an extra copyright line kept from a copied file', () => {
			const copied = header.replace(
				'2026 The',
				'2026 Someone Else\n// SPDX-FileCopyrightText: 2026 The',
			)

			expect(hasHeader(copied)).toBe(true)
		})

		it('rejects a file without a copyright line', () => {
			expect(hasHeader('// SPDX-License-Identifier: AGPL-3.0-or-later\nexport {}\n')).toBe(false)
		})

		it('rejects a different license', () => {
			expect(hasHeader(header.replace('AGPL-3.0-or-later', 'MIT'))).toBe(false)
		})

		it('rejects a header buried below the top of the file', () => {
			expect(hasHeader(`${'\n'.repeat(10)}${header}\n`)).toBe(false)
		})
	})
})
