// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { beforeEach, describe, expect, it } from 'bun:test'

import { CurrentNote } from './current-note.svelte'

const plain = { button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false }

describe('CurrentNote', () => {
	let wide: boolean
	let announced: number[]
	let urls: number[]
	let prevented: number
	let current: CurrentNote

	function cancelable<T extends object>(event: T) {
		return {
			...event,
			preventDefault: () => {
				prevented += 1
			},
		}
	}

	beforeEach(() => {
		wide = true
		announced = []
		urls = []
		prevented = 0
		current = new CurrentNote({
			initial: 5,
			isWide: () => wide,
			announce: (id) => {
				announced.push(id)
			},
			writeUrl: (id) => {
				urls.push(id)
			},
		})
	})

	it('opens a clicked row beside the list, in the URL and in the pane', () => {
		current.click(cancelable(plain), 8)

		expect([current.current, urls, announced, prevented]).toEqual([8, [8], [8], 1])
	})

	it('tells the pane of the current row again, keeps the URL and the link from navigating', () => {
		current.click(cancelable(plain), 5)

		expect([current.current, urls, announced, prevented]).toEqual([5, [], [5], 1])
	})

	it('lets a narrow screen and a modified click follow the link', () => {
		current.click(cancelable({ ...plain, metaKey: true }), 8)
		wide = false
		current.click(cancelable(plain), 8)

		expect([current.current, announced, prevented]).toEqual([5, [], 0])
	})

	it('moves with the arrow keys and opens the row it lands on', () => {
		const context = { ids: [3, 5, 8], from: 5, selecting: false }

		expect(current.key(cancelable({ key: 'ArrowDown' }), context)).toBe(8)
		expect(current.key(cancelable({ key: 'ArrowUp' }), { ...context, from: 8 })).toBe(5)
		expect([announced, prevented]).toEqual([[8, 5], 2])
	})

	it('does nothing at the ends, in select mode or on a narrow screen', () => {
		const context = { ids: [3, 5, 8], from: 8, selecting: false }

		const keys = [
			current.key(cancelable({ key: 'ArrowDown' }), context),
			current.key(cancelable({ key: 'ArrowUp' }), { ...context, selecting: true }),
		]

		wide = false
		keys.push(current.key(cancelable({ key: 'ArrowUp' }), context))

		expect([keys, announced, prevented]).toEqual([[null, null, null], [], 0])
	})

	it('focuses the row links of its own list', () => {
		const base = new CurrentNote({ initial: null, from: 'base' })

		expect([current.linkOf(8), base.linkOf(8)]).toEqual(['/notes/8', '/notes/8?from=base'])
	})
})
