// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { describe, expect, it } from 'bun:test'

import { noteOpened, noteOpenedEvent, openedNoteId } from './events'

describe('events', () => {
	describe('openedNoteId', () => {
		it('reads the id of a note-opened event', () => {
			expect(openedNoteId(noteOpened(42))).toBe(42)
		})

		it.each([
			['no detail', null],
			['a detail without an id', {}],
			['a string id', { id: '42' }],
			['a fractional id', { id: 1.5 }],
			['id zero', { id: 0 }],
			['a negative id', { id: -3 }],
		])('rejects %s', (_case, detail) => {
			expect(openedNoteId(new CustomEvent(noteOpenedEvent, { detail }))).toBeNull()
		})

		it('rejects another event, and a plain event of the same type', () => {
			expect(openedNoteId(new CustomEvent('stockpot:other', { detail: { id: 42 } }))).toBeNull()
			expect(openedNoteId(new Event(noteOpenedEvent))).toBeNull()
		})
	})
})
