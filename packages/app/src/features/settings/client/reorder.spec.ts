// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { describe, expect, it } from 'bun:test'

import { isMoveKey, keyMove, moveItem, type KeyMove, type MoveKey } from './reorder'

const ids = [1, 2, 3, 4]

describe('reorder', () => {
	describe('moveItem', () => {
		it.each([
			[0, 2, [2, 3, 1, 4]],
			[3, 0, [4, 1, 2, 3]],
			[1, 1, [1, 2, 3, 4]],
			[1, 4, [1, 2, 3, 4]],
			[-1, 0, [1, 2, 3, 4]],
		])('moves %i to %i', (from, to, expected) => {
			expect(moveItem(ids, from, to)).toEqual(expected)
		})

		it('leaves the list it was given alone', () => {
			moveItem(ids, 0, 3)

			expect(ids).toEqual([1, 2, 3, 4])
		})
	})

	describe('keyMove', () => {
		it.each<[MoveKey, number, KeyMove<number>]>([
			['ArrowUp', 2, { items: [1, 3, 2, 4], index: 1 }],
			['ArrowDown', 2, { items: [1, 2, 4, 3], index: 3 }],
			['Home', 2, { items: [3, 1, 2, 4], index: 0 }],
			['End', 1, { items: [1, 3, 4, 2], index: 3 }],
			['ArrowUp', 0, { items: [1, 2, 3, 4], index: 0 }],
			['ArrowDown', 3, { items: [1, 2, 3, 4], index: 3 }],
		])('moves with %s from %i', (key, index, expected) => {
			expect(keyMove(ids, index, key)).toEqual(expected)
		})
	})

	describe('isMoveKey', () => {
		it('takes only the four move keys', () => {
			expect(
				['ArrowUp', 'ArrowDown', 'Home', 'End', 'Enter', 'a'].map((key) => isMoveKey(key)),
			).toEqual([true, true, true, true, false, false])
		})
	})
})
