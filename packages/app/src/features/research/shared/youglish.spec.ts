// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { describe, expect, it } from 'bun:test'

import { youglishUrl } from './youglish'

describe('youglishUrl', () => {
	it('builds the English pronunciation page for the trimmed term', () => {
		expect(youglishUrl('  serendipity ')).toBe('https://youglish.com/pronounce/serendipity/english')
	})

	it('encodes spaces and characters that would change the path', () => {
		expect(youglishUrl('a far cry / #1?')).toBe(
			'https://youglish.com/pronounce/a%20far%20cry%20%2F%20%231%3F/english',
		)
	})
})
