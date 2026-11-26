// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

/*
 * The pronunciation link on an English card. The app builds it from the note's own text, so it is
 * never an address an engine made up (docs/engines.md, "Links"). It is a plain outbound link: nothing
 * loads from YouGlish until the owner follows it, and a private note gets none.
 */
export function youglishUrl(term: string): string {
	return `https://youglish.com/pronounce/${encodeURIComponent(term.trim())}/english`
}
