// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

/*
 * Events one island sends on `globalThis` for another on the same page, since features never import
 * each other.
 */
import * as v from 'valibot'

/** A note was saved, or an Undo removed one: a list on the page loads its first page again. */
export const notesChangedEvent = 'stockpot:notes-changed'

/** The list opened a note beside it (768 and wider): the card pane loads that note's card. */
export const noteOpenedEvent = 'stockpot:note-opened'

const openedDetail = v.object({ id: v.pipe(v.number(), v.integer(), v.minValue(1)) })

export type NoteOpenedDetail = v.InferOutput<typeof openedDetail>

export function noteOpened(id: number): CustomEvent<NoteOpenedDetail> {
	return new CustomEvent(noteOpenedEvent, { detail: { id } })
}

/** The note id a `noteOpenedEvent` names, or `null` when its detail is not a positive integer id. */
export function openedNoteId(event: Event): number | null {
	if (!(event instanceof CustomEvent) || event.type !== noteOpenedEvent) {
		return null
	}

	const parsed = v.safeParse(openedDetail, event.detail)

	return parsed.success ? parsed.output.id : null
}
