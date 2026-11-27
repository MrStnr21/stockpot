// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

/** The list with the item at `from` moved to `to`; an index out of range changes nothing. */
export function moveItem<T>(items: readonly T[], from: number, to: number): T[] {
	const moved = items[from]

	if (moved === undefined || to < 0 || to >= items.length || from === to) {
		return [...items]
	}

	const rest = items.toSpliced(from, 1)

	return rest.toSpliced(to, 0, moved)
}

/** The keys a grip button moves its item with. */
export const moveKeys = ['ArrowUp', 'ArrowDown', 'Home', 'End'] as const

export type MoveKey = (typeof moveKeys)[number]

export function isMoveKey(key: string): key is MoveKey {
	return moveKeys.some((moveKey) => moveKey === key)
}

/** Where a key sends the item at `index` in a list of `count`: one up or down, or to an end. */
export function keyTarget(count: number, index: number, key: MoveKey): number {
	const targets = {
		ArrowUp: index - 1,
		ArrowDown: index + 1,
		Home: 0,
		End: count - 1,
	} satisfies Record<MoveKey, number>

	return Math.min(count - 1, Math.max(0, targets[key]))
}

export interface KeyMove<T> {
	readonly items: T[]
	/** Where the moved item is now. */
	readonly index: number
}

/** The list after a key on the grip of the item at `index`. */
export function keyMove<T>(items: readonly T[], index: number, key: MoveKey): KeyMove<T> {
	const target = keyTarget(items.length, index, key)

	return { items: moveItem(items, index, target), index: target }
}
