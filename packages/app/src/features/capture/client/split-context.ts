// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

/* The limits of `context` and `url` in `newNoteSchema` (`features/notes/schemas.ts`). */
export const maxContextLength = 4000

export const maxUrlLength = 2048

/** The one "where you saw it" field holds both, so it may be as long as the two together. */
export const contextFieldMaxLength = maxContextLength + maxUrlLength

export interface SplitContext {
	readonly context: string | null
	readonly url: string | null
}

function isWebUrl(token: string) {
	return (
		token.length <= maxUrlLength &&
		URL.canParse(token) &&
		['http:', 'https:'].includes(new URL(token).protocol)
	)
}

/**
 * Takes the first http(s) link out of the field as the note's `url`; the rest, as the owner typed
 * it, is its `context`. Where the link stood between two words, one space stays.
 */
export function splitContext(field: string): SplitContext {
	const link = [...field.matchAll(/\S+/gu)].find(([token]) => isWebUrl(token))

	if (link === undefined) {
		const context = field.trim()

		return { context: context === '' ? null : context, url: null }
	}

	const [url] = link
	const before = field.slice(0, link.index).replace(/[ \t]+$/u, '')
	const after = field.slice(link.index + url.length).replace(/^[ \t]+/u, '')
	const joint = /\S$/u.test(before) && /^\S/u.test(after) ? ' ' : ''
	const context = `${before}${joint}${after}`.trim()

	return { context: context === '' ? null : context, url }
}
