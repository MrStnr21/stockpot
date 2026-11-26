// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { blockTexts, type Block } from './blocks'

/** Words a minute the card header assumes: a careful read on a phone. */
const wordsPerMinute = 150

/** Whole minutes to read the blocks, at least one. */
export function readingMinutes(blocks: readonly Block[]): number {
	const words = blockTexts(blocks).reduce(
		(count, text) => count + text.split(/\s+/u).filter((word) => word !== '').length,
		0,
	)

	return Math.max(1, Math.ceil(words / wordsPerMinute))
}
