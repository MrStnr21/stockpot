// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { describe, expect, it } from 'bun:test'

import type { Dependency, Font } from './collect'
import { renderNotices, splitLicense } from './render'

const mitTerms = 'Permission is hereby granted, free of charge, to any person obtaining a copy.'

function mitPackage(name: string, holder: string): Dependency {
	return {
		name,
		version: '1.0.0',
		license: 'MIT',
		licenseText: `MIT License\n\nCopyright (c) 2026 ${holder}\n\n${mitTerms}\n`,
		noticeText: null,
	}
}

describe('render', () => {
	describe('splitLicense', () => {
		it('leaves notices further down in the text', () => {
			const bundled = `Copyright 2026 Ada\n\n${mitTerms}${'\n'.repeat(12)}Copyright 2020 Bundled`

			expect(splitLicense(bundled).copyrights).toEqual(['Copyright 2026 Ada'])
			expect(splitLicense(bundled).body).toEndWith('Copyright 2020 Bundled')
		})

		it('separates the copyright notices from the terms', () => {
			expect(splitLicense(`Copyright (c) 2026 Ada\n© 2025 Bob\n\n${mitTerms}`)).toEqual({
				copyrights: ['Copyright (c) 2026 Ada', '© 2025 Bob'],
				body: mitTerms,
			})
		})
	})

	describe('renderNotices', () => {
		describe('with two packages under the same terms', () => {
			const notices = renderNotices([mitPackage('ladle', 'Ada'), mitPackage('whisk', 'Bob')])

			it('prints the terms once', () => {
				expect(notices.split(mitTerms)).toHaveLength(2)
			})

			it('keeps every copyright notice', () => {
				expect(notices).toContain('- `ladle@1.0.0`: Copyright (c) 2026 Ada')
				expect(notices).toContain('- `whisk@1.0.0`: Copyright (c) 2026 Bob')
			})

			it('lists both in the package table', () => {
				expect(notices).toContain('| `ladle` | 1.0.0 | MIT |')
				expect(notices).toContain('| `whisk` | 1.0.0 | MIT |')
			})
		})

		describe('with a NOTICE file', () => {
			const sieve = { ...mitPackage('sieve', 'Cy'), license: 'Apache-2.0', noticeText: 'Sieve\n' }

			it('reproduces it', () => {
				expect(renderNotices([sieve])).toContain('### `sieve@1.0.0`\n\n````text\nSieve\n````')
			})
		})

		describe('with a package that ships no licence file', () => {
			const pan = { ...mitPackage('pan', 'Dee'), licenseText: null }

			it('says so instead of printing an empty block', () => {
				expect(renderNotices([pan])).toContain('_The package ships no licence file._')
			})
		})

		describe('with a bundled font', () => {
			const ofl = 'This Font Software is licensed under the SIL Open Font License.'

			const font: Font = {
				name: 'Serif',
				version: '2.0',
				license: 'OFL-1.1',
				source: 'https://example.com/serif',
				licenseText: `Copyright 2020 The Serif Authors\n\n${ofl}\n`,
			}

			const notices = renderNotices([], [font])

			it('lists it with version, licence and source', () => {
				expect(notices).toContain('| Serif | 2.0 | OFL-1.1 | <https://example.com/serif> |')
			})

			it('keeps its copyright and the licence text', () => {
				expect(notices).toContain('- `Serif@2.0`: Copyright 2020 The Serif Authors')
				expect(notices).toContain(ofl)
			})

			it('groups its licence text with the other fonts under the same terms', () => {
				const sans = { ...font, name: 'Sans', licenseText: `Copyright 2021 Sans\n\n${ofl}\n` }

				expect(renderNotices([], [font, sans]).split(ofl)).toHaveLength(2)
			})
		})
	})
})
