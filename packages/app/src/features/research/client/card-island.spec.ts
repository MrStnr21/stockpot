// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { afterEach, beforeEach, describe, expect, it, jest } from 'bun:test'
import { cardView, levelCard, levels } from '#tests/factories/card-views'
import { CardHarness } from '#tests/setup/card-controller'

import { noteOpened, notesChangedEvent } from '#/lib/events'

import { connectCard, NotesAnnouncer } from './card-island'

describe('card island', () => {
	let harness: CardHarness
	let announcer: NotesAnnouncer
	let disconnect: () => void

	const view = cardView('brief', {
		note: { id: 4, status: 'ready' },
		levels: levels({ card: levelCard('brief', 1) }),
	})

	function connect(followsList: boolean) {
		announcer = new NotesAnnouncer()
		harness = new CardHarness(view, { notesChanged: announcer.announce })
		disconnect = connectCard({ controller: harness.controller, announcer, followsList })
	}

	beforeEach(() => {
		jest.useFakeTimers()
	})

	afterEach(() => {
		disconnect()
		harness.controller.destroy()
		jest.useRealTimers()
	})

	it('looks again when another island changes notes', () => {
		connect(false)
		globalThis.dispatchEvent(new Event(notesChangedEvent))

		expect(harness.requests.sent()).toEqual(['GET /api/notes/4/card'])
	})

	it('does not answer its own announcement', () => {
		connect(false)
		announcer.announce()

		expect(harness.requests.calls).toHaveLength(0)
	})

	it('opens the note the list picks, only in the pane', () => {
		connect(false)
		globalThis.dispatchEvent(noteOpened(9))
		disconnect()
		connect(true)
		globalThis.dispatchEvent(noteOpened(9))

		expect(harness.requests.sent()).toEqual(['GET /api/notes/9/card'])
	})

	it('stops listening once disconnected', () => {
		connect(true)
		disconnect()
		globalThis.dispatchEvent(noteOpened(9))
		globalThis.dispatchEvent(new Event(notesChangedEvent))

		expect(harness.requests.calls).toHaveLength(0)
	})
})
