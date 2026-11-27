// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { describe, expect, it } from 'bun:test'

import {
	cardLanguages,
	isClockTime,
	issueMessage,
	languageOptions,
	timeZoneOptions,
} from './digest-view'

describe('digest view', () => {
	describe('isClockTime', () => {
		it.each(['00:00', '05:45', '23:59'])('takes %s', (value) => {
			expect(isClockTime(value)).toBe(true)
		})

		it.each(['24:00', '7:5', '07:60', '', '07:15:00'])('refuses %p', (value) => {
			expect(isClockTime(value)).toBe(false)
		})
	})

	describe('languageOptions', () => {
		it('names each language in the page’s language', () => {
			expect(languageOptions('en', 'en').slice(0, 3)).toEqual([
				{ value: 'en', label: 'English' },
				{ value: 'ru', label: 'Russian' },
				{ value: 'de', label: 'German' },
			])
			expect(languageOptions('en', 'ru')[1]).toEqual({ value: 'ru', label: 'Русский' })
		})

		it('adds a stored code the list does not have', () => {
			const options = languageOptions('sv', 'en')

			expect(options).toHaveLength(cardLanguages.length + 1)
			expect(options.at(-1)).toEqual({ value: 'sv', label: 'Swedish' })
		})
	})

	describe('timeZoneOptions', () => {
		it('adds the stored zone and sorts', () => {
			expect(timeZoneOptions(['Europe/Berlin', 'Asia/Tokyo'], 'Etc/GMT+5')).toEqual([
				'Asia/Tokyo',
				'Etc/GMT+5',
				'Europe/Berlin',
			])
		})

		it('lists a zone once', () => {
			expect(timeZoneOptions(['Asia/Tokyo'], 'Asia/Tokyo')).toEqual(['Asia/Tokyo'])
		})
	})

	describe('issueMessage', () => {
		it('drops the field path', () => {
			expect(issueMessage(['digest.time: Use HH:MM', 'other: No'])).toBe('Use HH:MM')
		})

		it('keeps a message without a path', () => {
			expect(issueMessage(['Change at least one setting'])).toBe('Change at least one setting')
		})

		it('is null without issues', () => {
			expect(issueMessage()).toBeNull()
		})
	})
})
