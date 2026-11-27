// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { describe, expect, it } from 'bun:test'

import { en } from '#/lib/i18n/en'
import { ru } from '#/lib/i18n/ru'

import { categorySubtitle, formatOptions, positionText } from './category-view'

describe('category view', () => {
	describe('categorySubtitle', () => {
		it('names the format and counts the notes', () => {
			const { categories, formats } = en.settings

			expect(categorySubtitle({ format: 'technology', noteCount: 23 }, categories, formats)).toBe(
				'Technology format · 23 notes',
			)
			expect(categorySubtitle({ format: 'brief', noteCount: 1 }, categories, formats)).toBe(
				'Brief format · 1 note',
			)
		})

		it('speaks Russian without plural forms', () => {
			const { categories, formats } = ru.settings

			expect(categorySubtitle({ format: 'report', noteCount: 9 }, categories, formats)).toBe(
				'Формат: Отчёт · заметок: 9',
			)
		})
	})

	describe('formatOptions', () => {
		it('lists the six formats in order with their descriptions', () => {
			const options = formatOptions(en.settings.formats)

			expect(options.map(({ id }) => id)).toEqual([
				'vocabulary',
				'technology',
				'comparison',
				'concept',
				'report',
				'brief',
			])
			expect(options[5]).toEqual({
				id: 'brief',
				name: 'Brief',
				text: 'Anything else: a short explanation with links.',
			})
		})
	})

	describe('positionText', () => {
		it('counts from one', () => {
			expect(positionText(en.settings.categories.position, 'Cooking', { index: 0, total: 7 })).toBe(
				'Cooking, position 1 of 7',
			)
		})
	})
})
