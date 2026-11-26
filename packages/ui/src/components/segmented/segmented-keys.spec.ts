// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { describe, expect, it } from 'bun:test'

import { tabAfterKey } from './segmented-keys'

describe('tabAfterKey', () => {
	it('moves right and left between neighbours', () => {
		expect(tabAfterKey('ArrowRight', { index: 0, count: 3 })).toBe(1)
		expect(tabAfterKey('ArrowLeft', { index: 2, count: 3 })).toBe(1)
	})

	it('wraps around both ends', () => {
		expect(tabAfterKey('ArrowRight', { index: 2, count: 3 })).toBe(0)
		expect(tabAfterKey('ArrowLeft', { index: 0, count: 3 })).toBe(2)
	})

	it('jumps to the first and last tab with Home and End', () => {
		expect(tabAfterKey('Home', { index: 1, count: 3 })).toBe(0)
		expect(tabAfterKey('End', { index: 1, count: 3 })).toBe(2)
	})

	it('follows the reading direction in a right-to-left row', () => {
		expect(tabAfterKey('ArrowLeft', { index: 0, count: 3, rtl: true })).toBe(1)
		expect(tabAfterKey('ArrowRight', { index: 0, count: 3, rtl: true })).toBe(2)
	})

	it('ignores other keys', () => {
		expect(tabAfterKey('ArrowDown', { index: 1, count: 3 })).toBeNull()
		expect(tabAfterKey('Enter', { index: 1, count: 3 })).toBeNull()
	})

	it('ignores a tab that is not in the row', () => {
		expect(tabAfterKey('ArrowRight', { index: -1, count: 3 })).toBeNull()
		expect(tabAfterKey('ArrowLeft', { index: 3, count: 3 })).toBeNull()
		expect(tabAfterKey('Home', { index: 0, count: 0 })).toBeNull()
	})
})
