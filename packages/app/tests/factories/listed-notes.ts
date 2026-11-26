// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { faker } from '@faker-js/faker'
import { Factory } from 'fishery'

import type { CountRow, NoteRow, NotesPage } from '#/features/notes/shared/types'

/* Newest first, one minute apart, so a list of them is in the order the server sends. */
const firstCreatedAt = Date.parse('2026-11-26T09:00:00Z')

/** A note as `GET /api/notes` lists it, with its dates as JSON carries them. */
export const listedNoteFactory = Factory.define<NoteRow>(({ sequence }) => {
	const createdAt = new Date(firstCreatedAt - sequence * 60_000).toISOString()

	return {
		id: sequence,
		text: `${faker.word.noun()} ${sequence}`,
		context: faker.lorem.sentence(),
		url: null,
		source: 'web',
		categoryId: 1,
		status: 'new',
		private: false,
		createdAt,
		updatedAt: createdAt,
		sense: null,
		flag: null,
		snippet: null,
	}
})

/** One page of the list: the last one unless a cursor is given. */
export const notesPageFactory = Factory.define<NotesPage>(() => ({
	notes: [],
	nextCursor: null,
	total: null,
}))

/** One group of `GET /api/notes/counts`. */
export const countRowFactory = Factory.define<CountRow>(() => ({
	categoryId: 1,
	status: 'new',
	count: faker.number.int({ min: 1, max: 40 }),
}))
