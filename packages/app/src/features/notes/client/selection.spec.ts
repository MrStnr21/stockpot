// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { describe, expect, it } from 'bun:test'

import {
	keepSelected,
	maxSelected,
	noSelection,
	pressNote,
	startSelecting,
	toggleNote,
	type Selection,
} from './selection'

function selecting(ids: number[]): Selection {
	return { isActive: true, ids }
}

describe('selection', () => {
	it('starts select mode with nothing selected', () => {
		expect(startSelecting(noSelection)).toEqual(selecting([]))
		expect(startSelecting(selecting([4]))).toEqual(selecting([4]))
	})

	it('keeps ids in the order they were picked', () => {
		const picked = [9, 2, 5].reduce(
			(selection, id) => toggleNote(selection, id).selection,
			startSelecting(noSelection),
		)

		expect(picked.ids).toEqual([9, 2, 5])
		expect(toggleNote(picked, 2)).toEqual({ selection: selecting([9, 5]), isRefused: false })
	})

	it('enters select mode with the long-pressed row selected, once', () => {
		const pressed = pressNote(noSelection, 7)

		expect(pressed).toEqual({ selection: selecting([7]), isRefused: false })
		expect(pressNote(pressed.selection, 7).selection).toEqual(selecting([7]))
	})

	describe('at the limit', () => {
		const full = selecting(Array.from({ length: maxSelected }, (_, index) => index + 1))

		it('refuses the 101st note and keeps the 100', () => {
			expect(toggleNote(full, 500)).toEqual({ selection: full, isRefused: true })
			expect(pressNote(full, 500)).toEqual({ selection: full, isRefused: true })
		})

		it('still lets a selected note go', () => {
			expect(toggleNote(full, 1).selection.ids).toHaveLength(maxSelected - 1)
		})
	})

	describe('keepSelected', () => {
		it('keeps only the given notes, in their order', () => {
			expect(keepSelected(selecting([3, 1, 2]), new Set([2, 3]))).toEqual(selecting([3, 2]))
		})

		it('ends select mode when none stay', () => {
			expect(keepSelected(selecting([3, 1]), new Set())).toEqual(noSelection)
		})
	})
})
