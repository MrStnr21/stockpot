// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { describe, expect, it } from 'bun:test'
import { iconNames } from '@stockpot/ui/icon'

import { categoryIcons, categoryLook, type CategoryLook } from './category-look'

describe('category-look', () => {
	it.each(categoryIcons)('offers %s only if the kit can draw it', (icon) => {
		expect(iconNames).toContain(icon)
	})

	it.each<[string, { color: string; icon: string }, CategoryLook]>([
		['a known look', { color: 'tech', icon: 'flask' }, { color: 'tech', icon: 'flask' }],
		['an unknown colour', { color: 'teal', icon: 'flask' }, { color: 'other', icon: 'flask' }],
		['an unknown icon', { color: 'idea', icon: 'rocket' }, { color: 'idea', icon: 'other' }],
	])('keeps %s', (_case, stored, look) => {
		expect(categoryLook(stored.color, stored.icon)).toEqual(look)
	})
})
