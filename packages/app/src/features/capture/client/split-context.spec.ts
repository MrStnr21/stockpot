// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { describe, expect, it } from 'bun:test'
import { faker } from '@faker-js/faker'

import { maxUrlLength, splitContext } from './split-context'

describe('splitContext', () => {
	const url = faker.internet.url()
	const otherUrl = faker.internet.url({ protocol: 'http' })
	const sentence = faker.lorem.sentence()
	const longUrl = `https://example.com/${faker.string.alpha(maxUrlLength)}`

	it.each([
		['an empty field', '', { context: null, url: null }],
		['whitespace alone', ' \n\t ', { context: null, url: null }],
		['text only', `  ${sentence}  `, { context: sentence, url: null }],
		['a URL only', ` ${url} `, { context: null, url }],
		['text and a URL', `${sentence} ${url}`, { context: sentence, url }],
		['a URL before the text', `${url}\n${sentence}`, { context: sentence, url }],
		['two URLs', `${url} and ${otherUrl}`, { context: `and ${otherUrl}`, url }],
		[
			'an ftp link',
			'ftp://example.com/file seen',
			{ context: 'ftp://example.com/file seen', url: null },
		],
		['a URL over the limit', `${longUrl} seen`, { context: `${longUrl} seen`, url: null }],
		['runs of whitespace', 'seen   in\n\na  talk', { context: 'seen in a talk', url: null }],
	])('splits %s', (_case, field, expected) => {
		expect(splitContext(field)).toEqual(expected)
	})
})
