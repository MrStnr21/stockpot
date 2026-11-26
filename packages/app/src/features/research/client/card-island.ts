// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

/*
 * The opened card's ties to the rest of the page. It tells other islands when its note changed, and
 * looks again when another island changes notes; it does not answer its own announcement, which
 * follows a fetch of its own. In the pane it also follows the note the list opens.
 */
import { listenToOthers, noteOpenedEvent, openedNoteId, type NotesAnnouncer } from '#/lib/events'

import type { CardController } from './card-controller.svelte'

export interface CardIslandOptions {
	readonly controller: CardController
	readonly announcer: NotesAnnouncer
	/** The pane opens the notes the list picks; the card page shows one note. */
	readonly followsList: boolean
}

/** Starts the card's polling and listens on the page for it; returns the cleanup. */
export function connectCard({ controller, announcer, followsList }: CardIslandOptions): () => void {
	function opened(event: Event) {
		const id = openedNoteId(event)

		if (id !== null) {
			controller.open(id).catch(() => null)
		}
	}

	controller.start()

	const stopListening = listenToOthers(announcer, () => {
		controller.refresh().catch(() => null)
	})

	if (followsList) {
		globalThis.addEventListener(noteOpenedEvent, opened)
	}

	return () => {
		stopListening()
		globalThis.removeEventListener(noteOpenedEvent, opened)
	}
}
