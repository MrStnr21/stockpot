// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { afterEach, beforeEach, describe, expect, it, jest } from 'bun:test'

import { errorToast, SettingsToasts, toastMs } from './settings-toasts.svelte'

describe('SettingsToasts', () => {
	let toasts: SettingsToasts

	beforeEach(() => {
		jest.useFakeTimers()
		toasts = new SettingsToasts()
	})

	afterEach(() => {
		toasts.destroy()
		jest.useRealTimers()
	})

	it('shows one toast at a time, each for 4 s', () => {
		toasts.show(errorToast('First'))
		jest.advanceTimersByTime(toastMs - 1)
		toasts.show(errorToast('Second'))
		jest.advanceTimersByTime(toastMs - 1)

		expect(toasts.current).toMatchObject({ tone: 'error', title: 'Second' })

		jest.advanceTimersByTime(1)

		expect(toasts.current).toBeNull()
	})
})
