// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { beforeEach, describe, expect, it, mock } from 'bun:test'

import { OrderedList } from './ordered-list.svelte'

describe('OrderedList', () => {
	let save: ReturnType<typeof mock<(items: readonly number[]) => Promise<boolean>>>
	let list: OrderedList<number>

	beforeEach(() => {
		save = mock(async () => true)
		list = new OrderedList({ initial: [1, 2, 3], save })
	})

	it('shows a move at once and saves it on commit', async () => {
		list.move(2, 0)

		expect(list.items).toEqual([3, 1, 2])
		expect(save).not.toHaveBeenCalled()
		expect(await list.commit()).toBe(true)
		expect(save).toHaveBeenCalledWith([3, 1, 2])
	})

	it('does not save an unchanged order', async () => {
		list.move(0, 1)
		list.move(1, 0)

		expect(await list.commit()).toBe(true)
		expect(save).not.toHaveBeenCalled()
	})

	it('puts back the saved order when the save fails', async () => {
		list.move(0, 2)
		await list.commit()
		save.mockImplementation(async () => false)
		list.move(0, 2)

		expect(await list.commit()).toBe(false)
		expect(list.items).toEqual([2, 3, 1])
	})
})
