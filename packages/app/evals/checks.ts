// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

/*
 * The automatic checks of the eval runner (evals/rubric.md). Each takes what one call produced and
 * returns a result, or `null` when the check does not apply to that note or format. The link check
 * needs the network and lives in links.ts.
 */
import * as v from 'valibot'

import type { EngineNote, JsonValue, OutputFormat } from '#/server/engines/contract'

import type { EvalNote } from './notes'

export const checkIds = [
	'schema',
	'links',
	'oneSentence',
	'uncertain',
	'filler',
	'private',
	'category',
	'senses',
] as const

export type CheckId = (typeof checkIds)[number]

export interface CheckResult {
	readonly check: CheckId
	readonly passed: boolean
	/** Why it failed, for the report. */
	readonly detail: string | null
}

function pass(check: CheckId): CheckResult {
	return { check, passed: true, detail: null }
}

function fail(check: CheckId, detail: string): CheckResult {
	return { check, passed: false, detail }
}

/** The answer matches the call's format. Engines validate too; this holds whatever an engine does. */
export function checkSchema(output: OutputFormat, answer: JsonValue): CheckResult {
	const result = v.safeParse(output.schema, answer)

	if (result.success) {
		return pass('schema')
	}

	return fail('schema', result.issues.map((issue) => issue.message).join('; '))
}

/** The schema check of a call the engine rejected as `invalid`, with the engine's issues. */
export function invalidAnswer(issues: readonly string[]): CheckResult {
	return fail('schema', issues.join('; '))
}

const sourceUrl = v.object({ url: v.string() })

const sharedFields = v.looseObject({
	sources: v.optional(v.array(sourceUrl), []),
	uncertain: v.optional(v.boolean()),
	summary: v.optional(v.string()),
})

type SharedFields = v.InferOutput<typeof sharedFields>

/** The fields every card shares, read from an answer of any format. */
export function sharedCardFields(card: JsonValue): SharedFields {
	const result = v.safeParse(sharedFields, card)

	return result.success ? result.output : { sources: [] }
}

/** The addresses a card cites, each once. */
export function cardLinks(card: JsonValue): string[] {
	return [...new Set(sharedCardFields(card).sources.map(({ url }) => url))]
}

// The formats whose `summary` is "What it is, in one sentence."
const oneLinerFormats = new Set(['technology', 'comparison'])

/** How many sentences `text` holds, by the Unicode sentence rules for `language`. */
export function countSentences(text: string, language: string): number {
	const segmenter = new Intl.Segmenter(language, { granularity: 'sentence' })

	return [...segmenter.segment(text)].filter(({ segment }) => segment.trim() !== '').length
}

/** The one-liner of a `technology` or `comparison` card is a single sentence. */
export function checkOneSentence(
	format: string,
	card: JsonValue,
	language: string,
): CheckResult | null {
	const { summary } = sharedCardFields(card)

	if (!oneLinerFormats.has(format) || summary === undefined) {
		return null
	}

	const sentences = countSentences(summary, language)

	return sentences === 1 ? pass('oneSentence') : fail('oneSentence', `${sentences} sentences`)
}

/** A note composed to be unknowable gets a card marked `uncertain`, with no invented sources. */
export function checkUncertain(note: EvalNote, card: JsonValue): CheckResult | null {
	if (!note.expected.uncertain) {
		return null
	}

	const { uncertain, sources } = sharedCardFields(card)

	if (uncertain !== true) {
		return fail('uncertain', 'not marked uncertain')
	}

	return sources.length === 0 ? pass('uncertain') : fail('uncertain', `${sources.length} sources`)
}

/** No text in the answer uses a filler phrase from the rubric, in any letter case. */
export function checkFiller(card: JsonValue, phrases: readonly string[]): CheckResult {
	// The JSON text holds every value at any depth; the keys never match a phrase.
	const text = JSON.stringify(card).toLowerCase()
	const found = phrases.filter((phrase) => text.includes(phrase.toLowerCase()))

	return found.length === 0 ? pass('filler') : fail('filler', found.map((p) => `"${p}"`).join(', '))
}

const fillerHeading = '## Filler phrases'

function listItems(text: string): string[] {
	return text
		.split('\n')
		.filter((line) => line.startsWith('- '))
		.map((line) => line.slice(2).trim())
		.filter((phrase) => phrase !== '')
}

/**
 * The filler phrases for a card language: the list under the rubric's "Filler phrases" subheading
 * that ends with the language code, such as "### Russian (ru)". Empty for a language without one.
 */
export function parseFillerPhrases(rubric: string, language: string): string[] {
	const start = rubric.indexOf(fillerHeading)

	if (start === -1) {
		throw new Error(`The rubric has no "${fillerHeading}" section`)
	}

	const section =
		rubric
			.slice(start + fillerHeading.length)
			.split(/^## /mu, 1)
			.at(0) ?? ''

	const list = section
		.split(/^### /mu)
		.slice(1)
		.find((part) => part.split('\n', 1).at(0)?.trim().endsWith(`(${language})`) === true)

	return list === undefined ? [] : listItems(list)
}

/** What the engine received for a note: the note and, for a card, the earlier cards. */
export interface SentInput {
	readonly note: EngineNote
	readonly previous: readonly JsonValue[]
}

/** A private note reaches the engine as its term alone: no text, context, link or earlier cards. */
export function checkPrivate(note: EvalNote, sent: SentInput): CheckResult | null {
	if (!note.private) {
		return null
	}

	const leaked = [
		sent.note.text === null ? null : 'text',
		sent.note.context === null ? null : 'context',
		sent.note.url === null ? null : 'link',
		sent.previous.length === 0 ? null : 'earlier cards',
	].filter((field) => field !== null)

	return leaked.length === 0 ? pass('private') : fail('private', `sent ${leaked.join(', ')}`)
}

function acceptedFormats(note: EvalNote): string[] {
	return [note.expected.format, ...note.expected.alsoAccept]
}

/**
 * The preselected suggestion is the note's category or one it also fits. The eval's categories
 * are the built-in ones, whose ids are their format ids.
 */
export function checkCategory(note: EvalNote, categories: readonly string[]): CheckResult {
	const first = categories.at(0)

	if (first !== undefined && acceptedFormats(note).includes(first)) {
		return pass('category')
	}

	return fail('category', `suggested ${categories.join(', ') || 'nothing'}`)
}

/** An ambiguous term gets at least two senses to pick from. */
export function checkSenses(note: EvalNote, senseCount: number): CheckResult | null {
	if (note.expected.senses.length < 2) {
		return null
	}

	return senseCount >= 2 ? pass('senses') : fail('senses', `${senseCount} senses`)
}
