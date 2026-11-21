// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { en, type Messages } from './en'
import { ru } from './ru'

export type Locale = 'en' | 'ru'

const catalogs: Record<Locale, Messages> = { en, ru }

const languageRange = /^(?<tag>[A-Za-z]{1,8}(?:-[A-Za-z0-9]{1,8})*|\*)\s*(?:;\s*q=(?<q>[\d.]+))?$/u

/**
 * The locale for an `Accept-Language` header: the most preferred language we have strings for
 * (`ru` and `ru-*` are Russian, `en` and `en-*` English), highest q first and header order on a tie.
 * Ranges with q=0 or a malformed q are skipped; with no match, or no header, it is English.
 */
export function pickLocale(acceptLanguage: string | null): Locale {
	const ranges = (acceptLanguage ?? '').split(',').flatMap((part, order) => {
		const match = languageRange.exec(part.trim())
		const quality = match?.groups?.q === undefined ? 1 : Number(match.groups.q)

		if (match?.groups === undefined || !(quality > 0 && quality <= 1)) {
			return []
		}

		return [{ language: match.groups.tag.split('-')[0]?.toLowerCase(), quality, order }]
	})

	ranges.sort((a, b) => b.quality - a.quality || a.order - b.order)

	return ranges.find(({ language }) => language === 'ru' || language === 'en')?.language === 'ru'
		? 'ru'
		: 'en'
}

/** The strings of a locale. */
export function t(locale: Locale): Messages {
	return catalogs[locale]
}
