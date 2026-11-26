// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { describe, expect, it } from 'bun:test'
import { faker } from '@faker-js/faker'

import { itemsBlock, textBlock } from './blocks'
import { readingMinutes } from './reading-time'

function words(count: number) {
	return faker.lorem.words(count)
}

describe('readingMinutes', () => {
	it('takes at least a minute', () => {
		const short = textBlock('whatItIs', words(3))

		expect(readingMinutes([])).toBe(1)
		expect(readingMinutes(short)).toBe(1)
	})

	it('counts 150 words a minute over every block, rounding up', () => {
		const minute = textBlock('whatItIs', words(150))
		const more = itemsBlock('list', 'risks', [words(1)])

		expect(readingMinutes(minute)).toBe(1)
		expect(readingMinutes([...minute, ...more])).toBe(2)
	})
})
