// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

/*
 * The automatic checks of the eval runner (evals/rubric.md). Each takes what one call produced and
 * returns a result, or `null` when the check does not apply to that note or format. The link check
 * needs the network and lives in links.ts.
 */
import * as v from 'valibot'

import type { JsonValue, OutputFormat } from '#/server/engines/contract'

import { termOf, type EvalNote } from './notes'

export const checkIds = [
	'schema',
	'links',
	'oneSentence',
	'uncertain',
	'filler',
	'repeats',
	'private',
	'category',
	'senses',
] as const

export type CheckId = (typeof checkIds)[number]

export interface CheckResult {
	readonly check: CheckId
	/** `null` when the check applies but could not be verified, as for an engine it cannot observe. */
	readonly passed: boolean | null
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

/*
 * Abbreviations whose dot the Unicode sentence rules may take for a sentence end, per card language.
 * Their dots are dropped before counting; so are the dots of initials, such as "Р. Джонсоном".
 */
const abbreviations = {
	en: ['Dr.', 'Mr.', 'Mrs.', 'Ms.', 'U.S.', 'vs.', 'v.', 'e.g.', 'i.e.', 'etc.'],
	ru: ['напр.', 'т. е.', 'и т. д.', 'и т. п.', 'см.'],
} as const satisfies Readonly<Record<string, readonly string[]>>

function escapeRegex(text: string): string {
	return text.replaceAll(/[.*+?^${}()|[\]\\]/gu, String.raw`\$&`)
}

// The words of an abbreviation may be written with or without the space between them.
function abbreviationPattern(abbreviation: string): RegExp {
	const words = abbreviation.split(' ').map((word) => escapeRegex(word))

	return new RegExp(String.raw`(?<!\p{L})${words.join(String.raw`\s*`)}`, 'giu')
}

const abbreviationPatterns = new Map(
	Object.entries(abbreviations).map(([language, list]) => [
		language,
		list.map((abbreviation) => abbreviationPattern(abbreviation)),
	]),
)

// A capital letter and a dot before a capitalized word: an initial, as in "J. R. R. Tolkien".
const initial = /(?<!\p{L})(?<letter>\p{Lu})\.(?=\s+\p{Lu})/gu

function withoutAbbreviationDots(text: string, language: string): string {
	const patterns = abbreviationPatterns.get(language) ?? []

	const plain = patterns.reduce(
		(current, pattern) => current.replaceAll(pattern, (match) => match.replaceAll('.', '')),
		text,
	)

	return plain.replaceAll(initial, '$<letter>')
}

/** How many sentences `text` holds, by the Unicode sentence rules for `language`. */
export function countSentences(text: string, language: string): number {
	const segmenter = new Intl.Segmenter(language, { granularity: 'sentence' })
	const segments = segmenter.segment(withoutAbbreviationDots(text, language))

	return [...segments].filter(({ segment }) => segment.trim() !== '').length
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

/** Lowercase, with straight apostrophes and е for ё, so a phrase matches however it is typed. */
function normalizeForMatch(text: string): string {
	return text
		.toLowerCase()
		.replaceAll(/[\u2018\u2019\u02BC]/gu, "'")
		.replaceAll('ё', 'е')
}

/** No text in the answer uses a filler phrase from the rubric, in any letter case. */
export function checkFiller(card: JsonValue, phrases: readonly string[]): CheckResult {
	// The JSON text holds every value at any depth; the keys never match a phrase.
	const text = normalizeForMatch(JSON.stringify(card))
	const found = phrases.filter((phrase) => text.includes(normalizeForMatch(phrase)))

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

// A value inside a JSON payload has its quotes, backslashes and line breaks escaped.
function appearsIn(payload: string, value: string): boolean {
	return payload.includes(value) || payload.includes(JSON.stringify(value).slice(1, -1))
}

/**
 * A private note leaves the machine as its term alone: no payload the engine sent holds its text as
 * typed, its context or its link. `payloads` is `null` for an engine whose payload is not recorded.
 */
export function checkPrivate(
	note: EvalNote,
	payloads: readonly string[] | null,
): CheckResult | null {
	if (!note.private) {
		return null
	}

	if (payloads === null) {
		return { check: 'private', passed: null, detail: 'not verifiable for this engine' }
	}

	const details = [
		{ name: 'text', value: note.text === termOf(note.text) ? null : note.text },
		{ name: 'context', value: note.context },
		{ name: 'link', value: note.url },
	]

	const leaked = details.filter(
		({ value }) => value !== null && payloads.some((payload) => appearsIn(payload, value)),
	)

	return leaked.length === 0
		? pass('private')
		: fail('private', `sent ${leaked.map(({ name }) => name).join(', ')}`)
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
