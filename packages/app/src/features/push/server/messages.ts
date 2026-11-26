// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

/*
 * The text of each notification, in the subscription's locale. A notification shows on the lock
 * screen, so a private note is "a private note" everywhere and nothing else about it (its category,
 * its pages) is put into the message at all.
 */
import { t, type Locale } from '#/lib/i18n'

/** A notification before it is encrypted for one subscription; `ttl` is in seconds (RFC 8030). */
export interface PushMessage {
	readonly title: string
	readonly body: string
	readonly path: string
	readonly tag: string
	readonly ttl: number
	readonly urgency: 'normal'
	readonly topic?: string
}

/** A note whose card the owner asked for is ready; `report` is set for an idea's report. */
export interface ReadyMessageInput {
	readonly noteId: number
	readonly term: string
	readonly isPrivate: boolean
	readonly category: string | null
	readonly report: { readonly pages: number | null; readonly minutes: number | null } | null
}

/** The morning's digest: its notes in order and their total reading time. */
export interface DigestMessageInput {
	readonly notes: readonly { readonly term: string; readonly isPrivate: boolean }[]
	readonly minutes: number
}

// A ready card is worth showing for a day, a digest only until the next morning's.
const readyTtl = 86_400

const digestTtl = 43_200

const maxTermLength = 60

const digestTerms = 3

type Strings = ReturnType<typeof t>['push']

type PluralSuffix = 'One' | 'Few' | 'Many' | 'Other'

/* `Intl.PluralRules` names six forms; the strings have four, as neither English nor Russian ever
 * selects `zero` or `two`. */
const pluralSuffixes: Partial<Record<Intl.LDMLPluralRule, PluralSuffix>> = {
	one: 'One',
	few: 'Few',
	many: 'Many',
}

/** Which of a plural key's four strings fits `count` in a locale: `pagesRead${suffix}`. */
function pluralSuffix(count: number, locale: Locale): PluralSuffix {
	return pluralSuffixes[new Intl.PluralRules(locale).select(count)] ?? 'Other'
}

/* Each `{name}` replaced by its value in one pass, so a term that reads `{count}` or `$&` stays as
 * typed rather than being filled in again. */
function fill(template: string, values: Record<string, string | number>): string {
	return template.replaceAll(/\{(?<name>\w+)\}/gu, (placeholder, name: string) =>
		Object.hasOwn(values, name) ? String(values[name]) : placeholder,
	)
}

/* Whitespace and control characters collapse to one space, so a note pasted with line breaks reads
 * as one line, and a long one is cut to 60 code points, the ellipsis included. Code points, not
 * graphemes: one grapheme can carry any number of combining marks, so only a cut by code points
 * bounds the payload's size. An emoji sequence at the cut may lose its tail. */
function clean(text: string): string {
	const line = text.replaceAll(/[\s\p{Cc}]+/gu, ' ').trim()
	// oxlint-disable-next-line typescript/no-misused-spread -- Code points on purpose, see above.
	const points = [...line]

	if (points.length <= maxTermLength) {
		return line
	}

	return `${points
		.slice(0, maxTermLength - 1)
		.join('')
		.trimEnd()}…`
}

function shownTerm(strings: Strings, { term, isPrivate }: { term: string; isPrivate: boolean }) {
	return isPrivate ? strings.privateNote : clean(term)
}

// Whole minutes, and never "~0 min" for a card that has something to read.
function wholeMinutes(minutes: number): number {
	return Math.max(1, Math.round(minutes))
}

function readyBody(
	strings: Strings,
	{ isPrivate, category, report }: ReadyMessageInput,
	locale: Locale,
): string {
	if (isPrivate) {
		return strings.tapToRead
	}

	if (report === null) {
		return category === null
			? strings.tapToRead
			: fill(strings.readyBody, { category: clean(category) })
	}

	if (report.minutes === null) {
		return strings.tapToRead
	}

	const minutes = wholeMinutes(report.minutes)

	if (report.pages === null) {
		return fill(strings.reportMinutes, { minutes })
	}

	const pages = fill(strings[`pagesRead${pluralSuffix(report.pages, locale)}`], {
		count: report.pages,
	})

	return fill(strings.reportBody, { pages, minutes })
}

/** The "Ready" notification for a note whose Research now card is saved. Opens the card. */
export function readyMessage(input: ReadyMessageInput, locale: Locale): PushMessage {
	const strings = t(locale).push
	const title = input.report === null ? strings.readyTitle : strings.reportTitle

	return {
		title: fill(title, { term: shownTerm(strings, input) }),
		body: readyBody(strings, input, locale),
		path: `/notes/${input.noteId}`,
		tag: `ready-${input.noteId}`,
		ttl: readyTtl,
		urgency: 'normal',
	}
}

/**
 * The morning's "Digest" notification, or `null` when there is nothing to read. Opens Today. A newer
 * digest replaces one the push service still holds (`topic`) and one still on the screen (`tag`).
 */
export function digestMessage(
	{ notes, minutes }: DigestMessageInput,
	locale: Locale,
): PushMessage | null {
	if (notes.length === 0) {
		return null
	}

	const strings = t(locale).push
	const count = notes.length

	const terms = notes
		.slice(0, digestTerms)
		.map((note) => shownTerm(strings, note))
		.join(', ')

	const rest = count - digestTerms

	return {
		title: fill(strings[`digestTitle${pluralSuffix(count, locale)}`], {
			count,
			minutes: wholeMinutes(minutes),
		}),
		body: rest > 0 ? fill(strings.digestMore, { terms, count: rest }) : terms,
		path: '/',
		tag: 'digest',
		ttl: digestTtl,
		urgency: 'normal',
		topic: 'digest',
	}
}
