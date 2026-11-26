// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

interface TabRow {
	/** The focused tab. */
	index: number
	count: number
	rtl?: boolean
}

/**
 * The tab a key moves to, or `null` when the key does not move. Arrows wrap around the ends; Home
 * and End jump to the first and last tab. In a right-to-left row the arrows follow the reading
 * direction.
 */
export function tabAfterKey(key: string, { index, count, rtl = false }: TabRow): number | null {
	if (count === 0 || index < 0 || index >= count) {
		return null
	}

	const step = rtl ? -1 : 1

	const moves = new Map([
		['ArrowRight', index + step],
		['ArrowLeft', index - step],
		['Home', 0],
		['End', count - 1],
	])

	const next = moves.get(key)

	return next === undefined ? null : (next + count) % count
}
