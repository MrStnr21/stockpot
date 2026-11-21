// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { describe, expect, it } from 'bun:test'

import { en, type Messages } from './en'
import { pickLocale, t } from './index'
import { ru } from './ru'

type MessageNode = Messages | Messages[keyof Messages]

/** The locale's keys in order, every string replaced by null so only the keys are compared. */
function keyLayout(messages: Messages): string {
	return JSON.stringify(messages, (_key, value: MessageNode) =>
		Object(value) === value ? value : null,
	)
}

describe('i18n', () => {
	describe('pickLocale', () => {
		it.each([
			[null, 'en'],
			['', 'en'],
			['ru', 'ru'],
			['ru-RU,ru;q=0.9,en;q=0.8', 'ru'],
			['RU-ru', 'ru'],
			['en-US,en;q=0.9,ru;q=0.8', 'en'],
			['en;q=0.5, ru;q=0.9', 'ru'],
			['de, fr;q=0.9', 'en'],
			['de, ru;q=0.5', 'ru'],
			['*', 'en'],
			['ru;q=0, en', 'en'],
			['ru;q=oops, en', 'en'],
			['ru;q=1.5, en', 'en'],
			['russian', 'en'],
		] as const)('reads %p as %s', (header, locale) => {
			expect(pickLocale(header)).toBe(locale)
		})

		it('keeps header order between equal q-values', () => {
			expect(pickLocale('en, ru')).toBe('en')
			expect(pickLocale('ru, en')).toBe('ru')
		})
	})

	describe('t', () => {
		it('returns the strings of the locale asked for', () => {
			expect(t('en')).toBe(en)
			expect(t('ru')).toBe(ru)
		})

		it('has the same keys, in the same order, in Russian as in English', () => {
			expect(keyLayout(ru)).toBe(keyLayout(en))
		})

		it('has no empty string in either locale', () => {
			expect(JSON.stringify(ru)).not.toContain('""')
			expect(JSON.stringify(en)).not.toContain('""')
		})
	})
})
