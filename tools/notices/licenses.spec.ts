// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { describe, expect, it } from 'bun:test'

import { isCompatible } from './licenses'

describe('isCompatible', () => {
	it.each([
		'MIT',
		'Apache-2.0',
		'ISC',
		'BSD-3-Clause',
		'MPL-2.0',
		'OFL-1.1',
		'LGPL-3.0+',
		'GPL-3.0-or-later',
	])('accepts %s', (license) => {
		expect(isCompatible(license)).toBe(true)
	})

	it.each(['GPL-2.0-only', 'CC-BY-NC-4.0', 'SEE LICENSE IN LICENSE.txt', 'UNLICENSED', ''])(
		'rejects %s',
		(license) => {
			expect(isCompatible(license)).toBe(false)
		},
	)

	it('accepts an OR when one choice is compatible', () => {
		expect(isCompatible('(GPL-2.0-only OR MIT)')).toBe(true)
	})

	it('rejects an AND when one part is not', () => {
		expect(isCompatible('MIT AND CC-BY-NC-4.0')).toBe(false)
	})

	it('reads nested groups', () => {
		expect(isCompatible('(MIT OR GPL-2.0-only) AND (Apache-2.0 OR CC-BY-NC-4.0)')).toBe(true)
		expect(isCompatible('(GPL-2.0-only OR CC-BY-NC-4.0) AND MIT')).toBe(false)
	})
})
