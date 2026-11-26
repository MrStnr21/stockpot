// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { describe, expect, it } from 'bun:test'

import { keepNote, nextRowId, opensInPane, withNote } from './open-note'

const plain = { button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false }

describe('open note', () => {
	describe('opensInPane', () => {
		it('opens a plain primary click on a wide screen beside the list', () => {
			expect(opensInPane(plain, true)).toBe(true)
		})

		it('leaves a click on a narrow screen to the link', () => {
			expect(opensInPane(plain, false)).toBe(false)
		})

		it.each(['metaKey', 'ctrlKey', 'shiftKey', 'altKey'] as const)(
			'leaves a click with %s to the browser',
			(key) => {
				expect(opensInPane({ ...plain, [key]: true }, true)).toBe(false)
			},
		)

		it('leaves a middle click to the browser', () => {
			expect(opensInPane({ ...plain, button: 1 }, true)).toBe(false)
		})
	})

	describe('nextRowId', () => {
		const ids = [8, 5, 3]

		it('moves down and up in the order the rows are drawn', () => {
			expect([nextRowId(ids, 5, 'ArrowDown'), nextRowId(ids, 5, 'ArrowUp')]).toEqual([3, 8])
		})

		it('stays put at either end', () => {
			expect([nextRowId(ids, 3, 'ArrowDown'), nextRowId(ids, 8, 'ArrowUp')]).toEqual([null, null])
		})

		it('does nothing from a row that is not in the list, or for another key', () => {
			expect([nextRowId(ids, 4, 'ArrowDown'), nextRowId(ids, 5, 'ArrowLeft')]).toEqual([null, null])
		})
	})

	describe('withNote', () => {
		it('sets the note next to the filters and takes it out again', () => {
			expect(withNote('?status=ready&q=kafka', 7)).toBe('?status=ready&q=kafka&note=7')
			expect(withNote('?status=ready&note=7', 9)).toBe('?status=ready&note=9')
			expect(withNote('?note=7', null)).toBe('')
		})
	})

	describe('keepNote', () => {
		it('keeps the open note when the filters change', () => {
			expect(keepNote('?status=read', '?status=ready&note=7')).toBe('?status=read&note=7')
			expect(keepNote('', '?note=7')).toBe('?note=7')
		})

		it('adds nothing without a valid open note', () => {
			expect(keepNote('?status=read', '?status=ready')).toBe('?status=read')
			expect(keepNote('?status=read', '?note=abc')).toBe('?status=read')
		})
	})
})
