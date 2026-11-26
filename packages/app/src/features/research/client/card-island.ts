// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

/*
 * The opened card's ties to the rest of the page. It tells other islands when its note changed, and
 * looks again when another island changes notes; it does not answer its own announcement, which
 * follows a fetch of its own. In the pane it also follows the note the list opens.
 */
import { noteOpenedEvent, notesChangedEvent, openedNoteId } from '#/lib/events'

import type { CardController } from './card-controller.svelte'

/** Announces `notesChangedEvent` and remembers, for the length of the dispatch, that it is its own. */
export class NotesAnnouncer {
	#own = false

	public readonly announce = (): void => {
		this.#own = true

		try {
			globalThis.dispatchEvent(new Event(notesChangedEvent))
		} finally {
			this.#own = false
		}
	}

	public isOwn(): boolean {
		return this.#own
	}
}

export interface CardIslandOptions {
	readonly controller: CardController
	readonly announcer: NotesAnnouncer
	/** The pane opens the notes the list picks; the card page shows one note. */
	readonly followsList: boolean
}

/** Starts the card's polling and listens on the page for it; returns the cleanup. */
export function connectCard({ controller, announcer, followsList }: CardIslandOptions): () => void {
	function notesChanged() {
		if (!announcer.isOwn()) {
			controller.refresh().catch(() => null)
		}
	}

	function opened(event: Event) {
		const id = openedNoteId(event)

		if (id !== null) {
			controller.open(id).catch(() => null)
		}
	}

	controller.start()
	globalThis.addEventListener(notesChangedEvent, notesChanged)

	if (followsList) {
		globalThis.addEventListener(noteOpenedEvent, opened)
	}

	return () => {
		globalThis.removeEventListener(notesChangedEvent, notesChanged)
		globalThis.removeEventListener(noteOpenedEvent, opened)
	}
}
