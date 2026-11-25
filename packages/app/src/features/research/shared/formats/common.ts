// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

/*
 * Building blocks every card format shares (docs/engines.md, "Formats"). Each schema is written once in
 * Valibot: it validates engine output, and the JSON Schema derived from it tells the provider what to
 * return. Field descriptions travel in that JSON Schema, so they are the field-level prompt.
 *
 * Every object is strict and every field required (`null` or an empty list stands for "nothing"),
 * because strict structured-output modes accept only that shape. Transformations such as `trim` have
 * no JSON Schema form, so cleaning text up is the caller's job, after validation.
 */
import * as v from 'valibot'

import { list, pattern, text, textOrNull, type List } from '#/lib/json-schema'
import type { Depth } from '#/server/engines/contract'

// The field helpers live in lib/ because the suggestion schema in server/engines uses them too.
export { list, text, textOrNull } from '#/lib/json-schema'

// HTTP(S) only, also in the JSON Schema, so a provider never offers another scheme.
const httpUrl = pattern('^https?://')

const url = v.pipe(
	v.string(),
	v.url(),
	v.regex(httpUrl),
	v.maxLength(2000),
	v.description(
		'The address of a page you opened or saw in search results while writing this card. Never an address from memory or one you built yourself.',
	),
)

/** A page the engine opened while it wrote the card (the link policy in docs/engines.md). */
export const sourceSchema = v.strictObject({
	title: text(200, 'The title of the page, as the page itself shows it.'),
	url,
})

export type Source = v.InferOutput<typeof sourceSchema>

export function sources(
	max: number,
	description = 'Pages that back the card up, best first. Leave the list empty rather than add a page you did not see.',
): List<typeof sourceSchema> {
	return list(sourceSchema, { min: 0, max }, description)
}

export const uncertain = v.pipe(
	v.boolean(),
	v.description(
		'True when you could not confirm the main facts: the term is too new, too narrow or ambiguous, or the sources disagree.',
	),
)

/** The fields that open every first-level card: they record which meaning was explained, for repeats. */
export const senseFields = {
	sense: text(
		120,
		'The meaning of the term this card explains, in a few words, such as "YouTube streaming protocol". Name it even when the term has only one meaning.',
	),
	aliases: list(
		text(80, 'Another name or spelling.'),
		{ min: 0, max: 5 },
		'Other names, spellings and abbreviations of the term in this meaning.',
	),
}

/** One depth level of a format: what it asks the engine for and the shape of the answer. */
export interface Level {
	readonly instructions: string
	readonly schema: v.GenericSchema
}

/**
 * A card format. A category points to one; several categories may share it. `research` formats are
 * long reports written by the `research` task, all others are cards written by `explain`.
 */
export interface Format {
	readonly task: 'explain' | 'research'
	readonly instructions: string
	readonly levels: Readonly<Record<Depth, Level>>
}

export const firstLevelInstructions =
	'This is the first card about the term: something to read in a minute on a phone, plain and concrete.'

/** Level 2, shared by every format that has no level of its own: how it works and its trade-offs. */
export const deeperLevel = {
	instructions:
		'This is the second card about the term. The reader has read the earlier card, given below: build on it and do not repeat it. Explain how it works and what it trades off.',
	schema: v.strictObject({
		howItWorks: text(
			2000,
			'How it works underneath, in a few short paragraphs, starting where the earlier card stopped.',
		),
		tradeoffs: list(
			text(300, 'One trade-off or limit.'),
			{ min: 1, max: 6 },
			'What it costs, where it breaks down and when to choose something else.',
		),
		sources: sources(5),
		uncertain,
	}),
} as const satisfies Level

/** Level 3, shared by every format that has no level of its own: hands-on, with sources. */
export const handsOnLevel = {
	instructions:
		'This is the third card about the term. The reader has read the earlier cards, given below: do not repeat them. Make it hands-on: something to try, and where to go deeper.',
	schema: v.strictObject({
		steps: list(
			text(300, 'One step.'),
			{ min: 1, max: 8 },
			'A walkthrough the reader can follow in under an hour, in order.',
		),
		example: textOrNull(
			4000,
			'A code sample or a worked example that the steps use, or null when none fits.',
		),
		sources: sources(
			8,
			'Primary sources and in-depth material: documentation, specifications, papers, talks. Best first.',
		),
		uncertain,
	}),
} as const satisfies Level

/**
 * A card as the next level sees it, below "Earlier cards": whether the engine was sure of the facts
 * says nothing the deeper card could build on.
 */
export function earlierCard<TCard extends Readonly<Record<string, unknown>>>(
	card: TCard,
): Omit<TCard, 'uncertain'> {
	const { uncertain: _uncertain, ...rest } = card

	return rest
}
