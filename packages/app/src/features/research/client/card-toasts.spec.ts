// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { afterEach, beforeEach, describe, expect, it, jest } from 'bun:test'

import { CardToasts, toastMs } from './card-toasts.svelte'

describe('CardToasts', () => {
	let toasts: CardToasts

	beforeEach(() => {
		jest.useFakeTimers()
		toasts = new CardToasts()
	})

	afterEach(() => {
		toasts.destroy()
		jest.useRealTimers()
	})

	it('shows a toast for 4 s', () => {
		toasts.show('Kept in Base')

		expect(toasts.current).toMatchObject({ tone: 'default', title: 'Kept in Base' })

		jest.advanceTimersByTime(toastMs)

		expect(toasts.current).toBeNull()
	})

	it('replaces the toast on screen, and keeps the new one its full time', () => {
		toasts.show('Kept in Base')
		jest.advanceTimersByTime(toastMs - 1)
		toasts.show('Couldn’t reach your server.', 'error')
		jest.advanceTimersByTime(toastMs - 1)

		expect(toasts.current).toMatchObject({ tone: 'error', title: 'Couldn’t reach your server.' })
	})
})
