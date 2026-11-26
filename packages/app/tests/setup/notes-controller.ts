// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { countRowFactory, listedNoteFactory, notesPageFactory } from '#tests/factories/listed-notes'
import { NotesFetch } from '#tests/setup/notes-fetch'

import {
	NotesController,
	type NotesControllerOptions,
	type NotesStrings,
} from '#/features/notes/client/notes-controller.svelte'
import { noFilters } from '#/features/notes/shared/filters'

/** The texts the controller writes; the app passes them from `t(locale).notes`. */
export const notesStrings: NotesStrings = {
	today: 'Today',
	yesterday: 'Yesterday',
	thisWeek: 'This week',
	researchingToastOne: 'Researching 1 note',
	researchingToastOther: 'Researching {count} notes',
	movedToastOne: 'Moved 1 note to {category}',
	movedToastOther: 'Moved {count} notes to {category}',
	archivedToastOne: 'Archived 1 note',
	archivedToastOther: 'Archived {count} notes',
	notArchivedOne: '1 note is being researched and was not archived.',
	notArchivedOther: '{count} notes are being researched and were not archived.',
	deletedElsewhereOne: '1 note was deleted elsewhere.',
	deletedElsewhereOther: '{count} notes were deleted elsewhere.',
	selectLimitToast: 'Select up to 100 notes at a time',
	bulkFailedToast: 'Couldn’t reach your server. Nothing changed.',
	loadFailedToast: 'Couldn’t reach your server.',
}

export const notesRenderedAt = Date.parse('2026-11-26T10:00:00Z')

/** The real notes controller over a fetch the spec answers by hand. */
export class NotesHarness {
	public readonly requests = new NotesFetch()

	public readonly urls: string[] = []

	public signIns = 0

	public readonly controller: NotesController

	public constructor(options: Partial<NotesControllerOptions> = {}) {
		this.controller = new NotesController({
			initial: notesPageFactory.build({
				notes: listedNoteFactory.buildList(3),
				nextCursor: 'page-2',
			}),
			counts: countRowFactory.buildList(2),
			categories: [
				{ id: 1, name: 'Technology', color: 'tech', icon: 'tech' },
				{ id: 2, name: 'Concept', color: 'concept', icon: 'concept' },
			],
			filters: noFilters,
			timeZone: 'UTC',
			locale: 'en',
			renderedAt: notesRenderedAt,
			strings: notesStrings,
			fetch: this.requests.fetch,
			signIn: () => {
				this.signIns += 1
			},
			writeUrl: (search) => {
				this.urls.push(search)
			},
			now: () => notesRenderedAt,
			...options,
		})
	}

	/** Selects these rows the way a tap in select mode does. */
	public select(...ids: number[]): void {
		this.controller.startSelecting()

		for (const id of ids) {
			this.controller.toggle(id)
		}
	}

	public toast(): string | undefined {
		return this.controller.toasts.current?.title
	}
}
