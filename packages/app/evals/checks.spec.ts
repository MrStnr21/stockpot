// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { file } from 'bun'
import { describe, expect, it } from 'bun:test'
import { join } from 'node:path'

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
import { parseNotes, type EvalNote } from './notes'

function evalNote(
	overrides: Partial<EvalNote> = {},
	expected: Partial<EvalNote['expected']> = {},
): EvalNote {
	const line = JSON.stringify({
		id: 'note',
		text: 'Note',
		context: null,
		url: null,
		private: false,
		language: 'en',
		source: 'composed',
		tests: 'A test.',
		...overrides,
		expected: { format: 'technology', ...expected },
	})

	const note = parseNotes(line, 'test.jsonl').at(0)

	if (note === undefined) {
		throw new Error('The test note did not parse')
	}

	return note
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
		])('counts %p as %p sentences', (text, count) => {
			expect(countSentences(text, 'en')).toBe(count)
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

		it('passes a card without filler', () => {
			expect(checkFiller(briefCard, ['delve into'])).toMatchObject({ passed: true })
		})
	})

	describe('parseFillerPhrases', () => {
		it('reads the list under its heading only', () => {
			const rubric =
				'# Rubric\n\n- not this\n\n## Filler phrases\n\n- delve into\n- "a testament to"\n\n## Next\n\n- nor this\n'

			expect(parseFillerPhrases(rubric)).toEqual(['delve into', 'a testament to'])
		})

		it('reads the committed rubric', async () => {
			const rubric = await file(join(import.meta.dir, 'rubric.md')).text()

			expect(parseFillerPhrases(rubric)).toContain('delve into')
		})
	})

	describe('checkPrivate', () => {
		const privateNote = evalNote({ private: true, context: 'from a lab report' })
		const termOnly = { term: 'note', text: null, context: null, url: null, isPrivate: true }

		it('passes when the engine received the term alone', () => {
			expect(checkPrivate(privateNote, { note: termOnly, previous: [] })).toMatchObject({
				passed: true,
			})
		})

		it('names every field that leaked', () => {
			const sent = { note: { ...termOnly, context: 'from a lab report' }, previous: [briefCard] }

			expect(checkPrivate(privateNote, sent)).toMatchObject({
				passed: false,
				detail: 'sent context, earlier cards',
			})
		})

		it('does not apply to a public note', () => {
			expect(checkPrivate(evalNote(), { note: termOnly, previous: [] })).toBeNull()
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
