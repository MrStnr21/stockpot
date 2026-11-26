// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { afterEach, beforeEach, describe, expect, it, jest } from 'bun:test'

import { longPress, longPressMs, longPressSlopPx } from './long-press'

interface PointerFields {
	readonly clientX?: number
	readonly clientY?: number
	readonly button?: number
}

function pointer(type: string, fields: PointerFields = {}) {
	return Object.assign(
		new Event(type, { cancelable: true }),
		{ clientX: 0, clientY: 0, button: 0 },
		fields,
	)
}

describe('longPress', () => {
	let row: EventTarget
	let styles: [string, string][]
	let detach: () => void
	let presses: number
	let clicks: number

	beforeEach(() => {
		jest.useFakeTimers()
		styles = []
		presses = 0
		clicks = 0
		row = new EventTarget()
		detach = longPress(() => {
			presses += 1
		})(
			Object.assign(row, {
				style: {
					setProperty: (name: string, value: string) => {
						styles.push([name, value])
					},
				},
			}),
		)
		row.addEventListener('click', () => {
			clicks += 1
		})
	})

	afterEach(() => {
		detach()
		jest.useRealTimers()
	})

	it('turns off the iOS link preview on the row', () => {
		expect(styles).toEqual([['-webkit-touch-callout', 'none']])
	})

	it('fires after the pointer is held for 500 ms', () => {
		row.dispatchEvent(pointer('pointerdown', { clientX: 40, clientY: 40 }))
		jest.advanceTimersByTime(longPressMs - 1)

		expect(presses).toBe(0)

		jest.advanceTimersByTime(1)

		expect(presses).toBe(1)
	})

	it('allows a wobble within 10 px', () => {
		row.dispatchEvent(pointer('pointerdown', { clientX: 40, clientY: 40 }))
		row.dispatchEvent(pointer('pointermove', { clientX: 46, clientY: 48 }))
		jest.advanceTimersByTime(longPressMs)

		expect(presses).toBe(1)
	})

	it.each([
		[
			'moved past 10 px',
			pointer('pointermove', { clientX: 40 + longPressSlopPx + 1, clientY: 40 }),
		],
		['released', pointer('pointerup')],
		['cancelled', pointer('pointercancel')],
	])('does not fire when the pointer is %s first', (_name, event) => {
		row.dispatchEvent(pointer('pointerdown', { clientX: 40, clientY: 40 }))
		jest.advanceTimersByTime(longPressMs / 2)
		row.dispatchEvent(event)
		jest.advanceTimersByTime(longPressMs)

		expect(presses).toBe(0)
	})

	it('ignores a button other than the primary one', () => {
		row.dispatchEvent(pointer('pointerdown', { button: 2 }))
		jest.advanceTimersByTime(longPressMs)

		expect(presses).toBe(0)
	})

	it('swallows the click after a long press, and only that one', () => {
		const swallowed = pointer('click')

		row.dispatchEvent(pointer('pointerdown'))
		jest.advanceTimersByTime(longPressMs)
		row.dispatchEvent(pointer('pointerup'))
		row.dispatchEvent(swallowed)

		expect(swallowed.defaultPrevented).toBe(true)
		expect(clicks).toBe(0)

		row.dispatchEvent(pointer('click'))

		expect(clicks).toBe(1)
	})

	it('lets a short tap click', () => {
		const tap = pointer('click')

		row.dispatchEvent(pointer('pointerdown'))
		row.dispatchEvent(pointer('pointerup'))
		row.dispatchEvent(tap)

		expect(tap.defaultPrevented).toBe(false)
		expect(clicks).toBe(1)
	})

	it('keeps the link menu closed while pressing, and leaves a right click alone', () => {
		const held = pointer('contextmenu')
		const rightClick = pointer('contextmenu')

		row.dispatchEvent(pointer('pointerdown'))
		row.dispatchEvent(held)
		row.dispatchEvent(pointer('pointerup'))
		row.dispatchEvent(pointer('pointerdown', { button: 2 }))
		row.dispatchEvent(rightClick)

		expect([held.defaultPrevented, rightClick.defaultPrevented]).toEqual([true, false])
	})

	it('stops listening when detached', () => {
		detach()
		row.dispatchEvent(pointer('pointerdown'))
		jest.advanceTimersByTime(longPressMs)

		expect(presses).toBe(0)
	})
})
