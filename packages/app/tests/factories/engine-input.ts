// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { faker } from '@faker-js/faker'
import { Factory } from 'fishery'

import { cardFormat } from '#/features/research/shared/formats'
import type { CardInput, EngineNote, SuggestInput } from '#/server/engines/contract'
import { suggestionFormat } from '#/server/engines/suggestion'

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

/**
 * A first-level technology card, the kind the recorded Gemini responses answer. The format is spread
 * over the factory's rather than passed to `build`, which would merge the two schemas.
 */
export function firstCardInput(): CardInput<'explain'> {
	return {
		...cardInputFactory.build(),
		depth: 1,
		previous: [],
		output: cardFormat('technology', 1),
	}
}

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
