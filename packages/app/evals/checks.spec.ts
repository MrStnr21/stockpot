// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { file } from 'bun'
import { describe, expect, it } from 'bun:test'
import { join } from 'node:path'
import { evalNoteFactory } from '#tests/factories/eval-notes'

import { cardFormat } from '#/features/research/shared/formats'

import {
	cardLinks,
	checkCategory,
	checkFiller,
	checkOneSentence,
	checkPrivate,
	checkSchema,
	checkSenses,
	checkUncertain,
	countSentences,
	parseFillerPhrases,
} from './checks'
import type { EvalNote } from './notes'

function evalNote(
	overrides: Partial<EvalNote> = {},
	expected: Partial<EvalNote['expected']> = {},
): EvalNote {
	const note = evalNoteFactory.build(overrides)

	return { ...note, expected: { ...note.expected, ...expected } }
}

const briefCard = {
	sense: 'a made-up term',
	aliases: [],
	explanation: 'Nothing is known about it.',
	sources: [],
	uncertain: true,
}

describe('eval checks', () => {
	describe('checkSchema', () => {
		it('passes an answer in the format', () => {
			expect(checkSchema(cardFormat('brief', 1), briefCard)).toMatchObject({ passed: true })
		})

		it('fails an answer that breaks the format', () => {
			expect(checkSchema(cardFormat('brief', 1), { sense: 'x' })).toMatchObject({ passed: false })
		})
	})

	describe('cardLinks', () => {
		it('lists each cited address once', () => {
			const source = { title: 'Page', url: 'https://example.com/' }

			expect(cardLinks({ ...briefCard, sources: [source, source] })).toEqual([
				'https://example.com/',
			])
		})
	})

	describe('checkOneSentence', () => {
		it.each([
			['Bun is a JavaScript runtime, e.g. for servers.', 1],
			['Bun is a runtime. It also bundles code.', 2],
			['Bun 1.4 is a runtime.', 1],
			['A protocol Dr. Hopper described for U.S. Navy computers.', 1],
			['A comparison of React vs. Vue for small apps.', 1],
			['The ruling in Roe v. Wade, cited in privacy law.', 1],
			['A format, i.e. a shape for cards, with fields, etc. for each.', 1],
			['A method described by J. R. R. Tolkien in a letter.', 1],
		])('counts %p as %p sentences in English', (text, count) => {
			expect(countSentences(text, 'en')).toBe(count)
		})

		it.each([
			['Среда для кода, напр. для серверов.', 1],
			['Среда, т. е. место, где выполняется код.', 1],
			['Языки, фреймворки и т. д. в одном обзоре.', 1],
			['Метод, описанный Р. Джонсоном в статье.', 1],
			['Это среда. Она быстрая.', 2],
		])('counts %p as %p sentences in Russian', (text, count) => {
			expect(countSentences(text, 'ru')).toBe(count)
		})

		it('fails a two-sentence summary of a technology card', () => {
			const card = { summary: 'It runs code. It is fast.' }

			expect(checkOneSentence('technology', card, 'en')).toMatchObject({ passed: false })
		})

		it('does not apply to formats without a one-liner', () => {
			expect(checkOneSentence('brief', briefCard, 'en')).toBeNull()
		})
	})

	describe('checkUncertain', () => {
		const unknowable = evalNote({}, { uncertain: true })

		it('passes an uncertain card without sources', () => {
			expect(checkUncertain(unknowable, briefCard)).toMatchObject({ passed: true })
		})

		it('fails a confident card', () => {
			const card = { ...briefCard, uncertain: false }

			expect(checkUncertain(unknowable, card)).toMatchObject({ passed: false })
		})

		it('fails an uncertain card that cites sources', () => {
			const card = { ...briefCard, sources: [{ title: 'Page', url: 'https://example.com/' }] }

			expect(checkUncertain(unknowable, card)).toMatchObject({ detail: '1 sources' })
		})

		it('does not apply to a note that can be known', () => {
			expect(checkUncertain(evalNote(), briefCard)).toBeNull()
		})
	})

	describe('checkFiller', () => {
		it('finds a phrase in any field and letter case', () => {
			const card = { ...briefCard, explanation: 'It Is Important To Note that it runs.' }

			expect(checkFiller(card, ['it is important to note'])).toMatchObject({ passed: false })
		})

		it.each([
			['It’s worth noting that it runs.', "it's worth noting"],
			['Стоит отметить, что всё работает.', 'стоит отметить'],
			['Давайте разберемся.', 'давайте разберёмся'],
		])('matches %p despite apostrophes and ё', (explanation, phrase) => {
			expect(checkFiller({ ...briefCard, explanation }, [phrase])).toMatchObject({ passed: false })
		})

		it('passes a card without filler', () => {
			expect(checkFiller(briefCard, ['delve into'])).toMatchObject({ passed: true })
		})
	})

	describe('parseFillerPhrases', () => {
		const rubric = [
			'# Rubric',
			'- not this',
			'## Filler phrases',
			'### English (en)',
			'- delve into',
			'- a testament to',
			'### Russian (ru)',
			'- стоит отметить',
			'## Next',
			'- nor this',
		].join('\n\n')

		it('reads the list for the card language only', () => {
			expect(parseFillerPhrases(rubric, 'en')).toEqual(['delve into', 'a testament to'])
		})

		it('stops at the next section', () => {
			expect(parseFillerPhrases(rubric, 'ru')).toEqual(['стоит отметить'])
		})

		it('has no phrases for a language without a list', () => {
			expect(parseFillerPhrases(rubric, 'de')).toEqual([])
		})

		it('reads both lists of the committed rubric', async () => {
			const committed = await file(join(import.meta.dir, 'rubric.md')).text()

			expect(parseFillerPhrases(committed, 'en')).toContain('delve into')
			expect(parseFillerPhrases(committed, 'ru')).toContain('стоит отметить')
		})
	})

	describe('checkPrivate', () => {
		const privateNote = evalNote({
			private: true,
			text: 'Ferritin level',
			context: 'said "low" in a lab report',
			url: 'https://example.com/report',
		})

		it('passes when no payload holds the private details', () => {
			const payloads = [JSON.stringify({ prompt: 'Explain: ferritin level' })]

			expect(checkPrivate(privateNote, payloads)).toMatchObject({ passed: true })
		})

		it('names every detail that left the machine, JSON-escaped or not', () => {
			const payloads = [
				JSON.stringify({ prompt: 'Ferritin level, said "low" in a lab report' }),
				'see https://example.com/report',
			]

			expect(checkPrivate(privateNote, payloads)).toMatchObject({
				passed: false,
				detail: 'sent text, context, link',
			})
		})

		it('is not verifiable without the payloads', () => {
			expect(checkPrivate(privateNote, null)).toEqual({
				check: 'private',
				passed: null,
				detail: 'not verifiable for this engine',
			})
		})

		it('does not apply to a public note', () => {
			expect(checkPrivate(evalNote(), [])).toBeNull()
		})
	})

	describe('checkCategory', () => {
		const between = evalNote({}, { format: 'technology', alsoAccept: ['vocabulary'] })

		it.each([['technology'], ['vocabulary']])('accepts %p first', (category) => {
			expect(checkCategory(between, [category, 'brief'])).toMatchObject({ passed: true })
		})

		it('fails when another category comes first', () => {
			expect(checkCategory(between, ['brief', 'technology'])).toMatchObject({ passed: false })
		})
	})

	describe('checkSenses', () => {
		const ambiguous = evalNote({}, { senses: ['the runtime', 'a bread roll'] })

		it('fails an ambiguous term with one sense', () => {
			expect(checkSenses(ambiguous, 1)).toMatchObject({ passed: false })
		})

		it('passes an ambiguous term with two senses', () => {
			expect(checkSenses(ambiguous, 2)).toMatchObject({ passed: true })
		})

		it('does not apply to a term with one meaning', () => {
			expect(checkSenses(evalNote(), 0)).toBeNull()
		})
	})
})
