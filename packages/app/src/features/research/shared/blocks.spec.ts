// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { describe, expect, it } from 'bun:test'

import {
	blockTexts,
	compareBlock,
	examplesBlock,
	itemsBlock,
	pairsBlock,
	plainBlock,
	textBlock,
} from './blocks'

describe('blocks', () => {
	it('leaves out a null or blank text', () => {
		expect([...textBlock('analogy', null), ...textBlock('analogy', ' \n\n ')]).toEqual([])
		expect([
			...plainBlock('note', 'mistake', null),
			...plainBlock('code', 'example', '\n'),
		]).toEqual([])
	})

	it('trims a note but keeps the indentation inside code', () => {
		expect(plainBlock('note', 'mistake', '  Mixing it up.  ')).toEqual([
			{ kind: 'note', heading: 'mistake', text: 'Mixing it up.' },
		])
		expect(plainBlock('code', 'example', '\n\nif (a) {\n  b()\n}\n\n')).toEqual([
			{ kind: 'code', heading: 'example', text: 'if (a) {\n  b()\n}' },
		])
	})

	it('drops blank items, and the block once none is left', () => {
		expect(itemsBlock('list', 'risks', [' One ', '', '  '])).toEqual([
			{ kind: 'list', heading: 'risks', items: ['One'] },
		])
		expect(itemsBlock('tags', 'tools', ['   '])).toEqual([])
		expect(pairsBlock('existing', [{ name: 'Drafts', note: ' ' }])).toEqual([])
		expect(examplesBlock('examples', [])).toEqual([])
	})

	it('lists every string a reader reads', () => {
		const blocks = [
			...textBlock('whatItIs', 'One.\n\nTwo.'),
			...compareBlock('alternatives', [{ name: 'Three', pros: 'Four', cons: 'Five' }]),
			...plainBlock('code', 'example', 'six()'),
		]

		expect(blockTexts(blocks)).toEqual(['One.', 'Two.', 'Three', 'Four', 'Five', 'six()'])
	})
})
