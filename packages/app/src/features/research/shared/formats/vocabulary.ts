// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

/*
 * A word or phrase in a language the reader is learning. The pronunciation link (YouGlish) is not
 * asked for: the app builds it from the term, so it cannot be a made-up address.
 */
import * as v from 'valibot'

import {
	firstLevelInstructions,
	list,
	senseFields,
	sources,
	text,
	textOrNull,
	uncertain,
	type Format,
} from './common'

const partsOfSpeech = [
	'noun',
	'verb',
	'adjective',
	'adverb',
	'phrasal verb',
	'idiom',
	'phrase',
	'other',
] as const

const example = v.strictObject({
	text: text(300, 'A short sentence that uses the word the way people really do.'),
	translation: text(300, 'The sentence in the card language.'),
})

const card = v.strictObject({
	...senseFields,
	translation: text(
		160,
		'The translation into the card language: one word, or a few when one is not enough.',
	),
	partOfSpeech: v.pipe(v.picklist(partsOfSpeech), v.description('The part of speech.')),
	difficulty: v.pipe(
		v.picklist(['easy', 'medium', 'hard']),
		v.description('How hard the word is for an upper-intermediate learner to use correctly.'),
	),
	examples: list(example, { min: 2, max: 3 }, 'Two usage examples, each with its translation.'),
	modelSentences: list(
		text(300, 'One sentence.'),
		{ min: 2, max: 3 },
		'Two sentences the reader can reuse as templates, with the word in a common construction.',
	),
	mistake: textOrNull(
		300,
		'The mistake learners typically make with it (articles, calques from their own language, false friends), or null when there is none worth noting.',
	),
	sources: sources(
		3,
		'Dictionary or usage pages, only for slang and new expressions; usually empty.',
	),
	uncertain,
})

const synonym = v.strictObject({
	word: text(80, 'A near synonym.'),
	difference: text(300, 'How it differs in meaning or use.'),
})

const nuance = v.strictObject({
	nuance: text(
		1200,
		'Register, connotation and when native speakers reach for it, in a short paragraph.',
	),
	synonyms: list(synonym, { min: 0, max: 5 }, 'Near synonyms and how each one differs.'),
	collocations: list(
		text(80, 'One collocation.'),
		{ min: 0, max: 8 },
		'Words it usually goes with, such as "make a decision".',
	),
	sources: sources(3),
	uncertain,
})

const exercise = v.strictObject({
	prompt: text(300, 'A gap to fill or a sentence to translate.'),
	answer: text(300, 'The expected answer.'),
})

const practice = v.strictObject({
	exercises: list(
		exercise,
		{ min: 3, max: 6 },
		'Exercises that make the reader use the word, from easy to hard.',
	),
	sources: sources(3),
	uncertain,
})

export const vocabulary = {
	task: 'explain',
	instructions:
		'Explain a word or phrase in the language the reader is learning, for someone who reads it well but wants to use it. Write translations and explanations in the card language; keep examples in the original language.',
	levels: {
		1: { instructions: firstLevelInstructions, schema: card },
		2: {
			instructions:
				'This is the second card about the word. The reader has read the earlier card, given below: do not repeat it. Explain the nuance: register, connotation, and how it differs from near synonyms.',
			schema: nuance,
		},
		3: {
			instructions:
				'This is the third card about the word. The reader has read the earlier cards, given below: do not repeat them. Make it practice: short exercises with answers.',
			schema: practice,
		},
	},
} as const satisfies Format
