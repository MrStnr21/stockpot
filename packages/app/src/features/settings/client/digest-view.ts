// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

/** The card languages the select offers; the server takes any two-letter code. */
export const cardLanguages = [
	'en',
	'ru',
	'de',
	'fr',
	'es',
	'it',
	'pt',
	'uk',
	'pl',
	'nl',
	'tr',
	'ja',
	'ko',
	'zh',
] as const

export const minDigestLimit = 1

export const maxDigestLimit = 50

const clockTime = /^(?:[01]\d|2[0-3]):[0-5]\d$/u

/** Whether a time field holds a whole `HH:MM` the server takes (24-hour). */
export function isClockTime(value: string): boolean {
	return clockTime.test(value)
}

export interface Option {
	readonly value: string
	readonly label: string
}

function capitalized(text: string, locale: string) {
	return text.charAt(0).toLocaleUpperCase(locale) + text.slice(1)
}

/** The card languages, each named in the page's language, with the stored code added when missing. */
export function languageOptions(stored: string, locale: string): Option[] {
	const names = new Intl.DisplayNames([locale], { type: 'language', fallback: 'code' })
	const known = cardLanguages.some((code) => code === stored)
	const codes: readonly string[] = known ? cardLanguages : [...cardLanguages, stored]

	return codes.map((code) => ({ value: code, label: capitalized(names.of(code) ?? code, locale) }))
}

/** The browser's time zones with the stored one added when it is missing, sorted. */
export function timeZoneOptions(supported: readonly string[], stored: string): string[] {
	return [...new Set([...supported, stored])].toSorted((a, b) => a.localeCompare(b, 'en'))
}

/** The message of a 400's first issue, without the field path the server puts before it. */
export function issueMessage(issues?: readonly string[]): string | null {
	const first = issues?.at(0)

	if (first === undefined) {
		return null
	}

	const separator = first.indexOf(': ')

	return separator === -1 ? first : first.slice(separator + 2)
}
