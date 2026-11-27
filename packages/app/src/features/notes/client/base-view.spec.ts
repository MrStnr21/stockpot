// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { describe, expect, it } from 'bun:test'
import { listedNoteFactory } from '#tests/factories/listed-notes'

import type { NotesCategory } from '../shared/types'
import { cameBack, canShowAll, groupKey, groupView } from './base-view'

const tech: NotesCategory = { id: 2, name: 'Technology', color: 'tech', icon: 'tech' }

const categories = new Map([[tech.id, tech]])

const strings = { noCategory: 'No category' }

describe('base view', () => {
	it('names a group after its category and wears its look', () => {
		expect(groupView({ categoryId: 2 }, categories, strings)).toEqual({
			key: 2,
			label: 'Technology',
			look: { color: 'tech', icon: 'tech' },
		})
	})

	it('reads the uncategorized group as No category with the Other look', () => {
		expect(groupView({ categoryId: null }, categories, strings)).toEqual({
			key: 'none',
			label: 'No category',
			look: { color: 'other', icon: 'other' },
		})
	})

	it('reads a category the page does not know as uncategorized, keeping its key', () => {
		expect(groupView({ categoryId: 9 }, categories, strings)).toEqual({
			key: 9,
			label: 'No category',
			look: { color: 'other', icon: 'other' },
		})
	})

	it('keys the uncategorized group as none', () => {
		expect([groupKey(4), groupKey(null)]).toEqual([4, 'none'])
	})

	it('offers Show all only when the group keeps more than its preview', () => {
		const notes = listedNoteFactory.buildList(3)

		expect([canShowAll({ count: 5, notes }), canShowAll({ count: 3, notes })]).toEqual([
			true,
			false,
		])
	})

	it('tells a page that came back through the history from one opened anew', () => {
		const back = [{ name: 'http://stockpot.test/base', type: 'back_forward' }]
		const opened = [{ name: 'http://stockpot.test/base', type: 'navigate' }]

		expect([cameBack(back), cameBack(opened), cameBack([])]).toEqual([true, false, false])
	})
})
