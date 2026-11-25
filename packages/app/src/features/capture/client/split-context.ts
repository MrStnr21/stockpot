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

/** Takes the first http(s) link out of the field as the note's `url`; the rest is its `context`. */
export function splitContext(field: string): SplitContext {
	const tokens = field
		.trim()
		.split(/\s+/u)
		.filter((token) => token !== '')
	const urlIndex = tokens.findIndex((token) => isWebUrl(token))
	const url = urlIndex === -1 ? null : (tokens[urlIndex] ?? null)
	const context = tokens.filter((_, index) => index !== urlIndex).join(' ')

	return { context: context === '' ? null : context, url }
}
