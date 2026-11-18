// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { faker } from '@faker-js/faker'
import { Factory } from 'fishery'

import { cardFormat, suggestionFormat } from '#/features/research/shared/formats'
import type { CardInput, EngineNote, SuggestInput } from '#/server/engines/contract'

import { technologyCardFactory } from './cards'

export const engineNoteFactory = Factory.define<EngineNote>(() => ({
	term: faker.word.noun(),
	text: faker.lorem.words(3),
	context: faker.lorem.sentence(),
	url: faker.internet.url(),
	isPrivate: false,
}))

export const privateNoteFactory = engineNoteFactory.params({ isPrivate: true })

/** A second-level technology card: it carries every field a card input can. */
export const cardInputFactory = Factory.define<CardInput<'explain'>>(() => ({
	task: 'explain',
	note: engineNoteFactory.build(),
	language: 'en',
	category: { name: 'Technology', instructions: faker.lorem.sentence() },
	depth: 2,
	previous: [technologyCardFactory.build()],
	output: cardFormat('technology', 2),
}))

export const suggestInputFactory = Factory.define<SuggestInput>(() => ({
	task: 'suggest',
	note: engineNoteFactory.build(),
	language: 'en',
	categories: [
		{ id: 'technology', name: 'Technology', hint: null },
		{ id: 'english', name: 'English', hint: 'Words and phrases to learn' },
	],
	output: suggestionFormat(['technology', 'english']),
}))
