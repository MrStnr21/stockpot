// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { faker } from '@faker-js/faker'
import { Factory } from 'fishery'

import type {
	SavedNote,
	SuggestAnswer,
	SuggestHistoryMatch,
	SuggestSense,
} from '#/features/capture/shared/types'

/** An answer of `POST /api/suggest` with one suggested category, as the capture sheet reads it. */
export const suggestAnswerFactory = Factory.define<SuggestAnswer>(({ sequence }) => ({
	history: [],
	categories: [sequence],
	senses: [],
	language: 'en',
	source: 'engine',
	pending: false,
}))

/** A term captured before, with the note and the card it left. */
export const historyMatchFactory = Factory.define<SuggestHistoryMatch>(({ sequence }) => ({
	term: faker.word.noun(),
	meaning: faker.lorem.sentence(),
	categoryId: sequence,
	state: 'seen',
	note: { id: sequence, status: 'ready' },
	lastCard: { noteId: sequence, sense: faker.lorem.sentence() },
}))

export const suggestSenseFactory = Factory.define<SuggestSense>(({ sequence }) => ({
	sense: faker.lorem.words(3),
	categoryId: sequence,
}))

/** A note as `POST /api/notes` answers it. */
export const savedNoteFactory = Factory.define<SavedNote>(({ sequence }) => ({
	id: sequence,
	text: faker.word.noun(),
	categoryId: faker.number.int({ min: 1, max: 6 }),
	private: false,
}))
