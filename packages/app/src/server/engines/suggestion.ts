// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

/*
 * The answer to the contract's `suggest` task (docs/engines.md, "Suggestions"). It lives with the
 * contract rather than with the card formats: it is not a card, and the capture feature builds it.
 */
import * as v from 'valibot'

import { deriveJsonSchema, list, text } from '#/lib/json-schema'

import type { OutputFormat } from './contract'

const instructions =
	'Suggest categories for a note the reader is typing, from the list of their categories. Answer from what you know, without searching. When the term has several common meanings, list them so the reader can pick one.'

const language = v.pipe(
	v.string(),
	v.length(2),
	v.description('The ISO 639-1 code of the language the note is written in, such as "en".'),
)

/**
 * Category ids are an enum of the owner's current categories, so a provider with structured output
 * cannot name one that does not exist.
 */
function suggestionSchema(categoryIds: readonly string[]) {
	const category = v.pipe(
		v.picklist(categoryIds),
		v.description('The id of one of the categories listed.'),
	)

	const sense = v.strictObject({
		sense: text(80, 'The meaning, in a few words, such as "baseball statistics".'),
		category,
	})

	return v.strictObject({
		categories: list(
			category,
			{ min: 1, max: 3 },
			'One to three categories that fit the note, best first.',
		),
		senses: list(
			sense,
			{ min: 0, max: 4 },
			'The distinct common meanings of the term, most likely first, each with the category it belongs to. Empty when it has one meaning.',
		),
		language,
	})
}

type SuggestionSchema = ReturnType<typeof suggestionSchema>

export type Suggestion = v.InferOutput<SuggestionSchema>

/** What capture hands an engine to suggest one of `categoryIds`. */
export function suggestionFormat(categoryIds: readonly string[]): OutputFormat<SuggestionSchema> {
	const schema = suggestionSchema(categoryIds)

	return { id: 'suggestion', instructions, schema, jsonSchema: deriveJsonSchema(schema) }
}
