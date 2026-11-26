// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { afterEach, beforeEach, describe, expect, it, jest } from 'bun:test'
import { notesStrings } from '#tests/setup/notes-controller'

import { bulkToast, counted, errorToast, NotesToasts, toastMs } from './notes-toasts.svelte'

describe('notes toasts', () => {
	describe('counted', () => {
		it('picks the key by the count', () => {
			expect(counted('1 note', '{count} notes', 1)).toBe('1 note')
			expect(counted('1 note', '{count} notes', 0)).toBe('0 notes')
			expect(counted('1 note', '{count} notes', 12)).toBe('12 notes')
		})
	})

	describe('bulkToast', () => {
		it('says what the action reached and nothing more when it reached every note', () => {
			expect(
				bulkToast(
					notesStrings,
					{ action: { kind: 'research' }, done: 1, conflicts: 0, deleted: 0 },
					'',
				),
			).toEqual({ tone: 'default', title: 'Researching 1 note', detail: null })
		})

		it('adds the notes it could not reach', () => {
			expect(
				bulkToast(
					notesStrings,
					{ action: { kind: 'archive' }, done: 3, conflicts: 2, deleted: 1 },
					'',
				),
			).toEqual({
				tone: 'default',
				title: 'Archived 3 notes',
				detail: '2 notes are being researched and were not archived. 1 note was deleted elsewhere.',
			})
		})

		it('names the category of a move', () => {
			expect(
				bulkToast(
					notesStrings,
					{ action: { kind: 'move', categoryId: 2 }, done: 2, conflicts: 0, deleted: 0 },
					'Concept',
				).title,
			).toBe('Moved 2 notes to Concept')
		})
	})

	describe('NotesToasts', () => {
		let toasts: NotesToasts

		beforeEach(() => {
			jest.useFakeTimers()
			toasts = new NotesToasts()
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

			expect(toasts.current?.title).toBe('Second')

			jest.advanceTimersByTime(1)

			expect(toasts.current).toBeNull()
		})
	})
})
