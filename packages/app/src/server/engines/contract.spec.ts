// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { describe, expect, it } from 'bun:test'
import { toJsonSchema } from '@valibot/to-json-schema'
import {
	cardInputFactory,
	privateNoteFactory,
	suggestInputFactory,
} from '#tests/factories/engine-input'
import * as v from 'valibot'

import {
	EngineError,
	parseOutput,
	redactPrivate,
	type EngineFailure,
	type JsonValue,
	type OutputFormat,
} from './contract'

const glossarySchema = v.strictObject({ summary: v.pipe(v.string(), v.nonEmpty()) })

const glossary: OutputFormat<typeof glossarySchema> = {
	id: 'glossary',
	instructions: 'Explain the term in one sentence.',
	schema: glossarySchema,
	jsonSchema: toJsonSchema(glossarySchema),
}

/** The failure `parseOutput` throws for `answer`, if any. */
function failureOf(answer: JsonValue): EngineFailure | undefined {
	try {
		parseOutput(glossary, answer)
	} catch (error) {
		if (error instanceof EngineError) {
			return error.failure
		}

		throw error
	}

	return undefined
}

describe('engine contract', () => {
	describe('redactPrivate', () => {
		it('sends only the term of a private note', () => {
			const input = cardInputFactory.build({ note: privateNoteFactory.build() })

			expect(redactPrivate(input)).toMatchObject({
				note: { term: input.note.term, text: null, context: null, url: null, isPrivate: true },
				previous: [],
			})
		})

		it("keeps the task's own settings for a private note", () => {
			const input = cardInputFactory.build({ note: privateNoteFactory.build() })

			expect(redactPrivate(input)).toMatchObject({
				task: input.task,
				category: input.category,
				depth: input.depth,
				language: input.language,
				output: input.output,
			})
		})

		it('sends only the term of a private note to suggest', () => {
			const input = suggestInputFactory.build({ note: privateNoteFactory.build() })

			expect(redactPrivate(input)).toEqual({
				...input,
				note: { term: input.note.term, text: null, context: null, url: null, isPrivate: true },
			})
		})

		it('passes a note that is not private through unchanged', () => {
			const input = cardInputFactory.build()

			expect(redactPrivate(input)).toBe(input)
		})
	})

	describe('parseOutput', () => {
		it('returns an answer that matches the format', () => {
			expect(parseOutput(glossary, { summary: 'A database in one file.' })).toEqual({
				summary: 'A database in one file.',
			})
		})

		it('fails with invalid, naming each field that does not match', () => {
			expect(failureOf({ summary: '' })).toEqual({
				kind: 'invalid',
				issues: ['summary: Invalid length: Expected !0 but received 0'],
			})
		})

		it('fails with invalid when the answer is not an object', () => {
			expect(failureOf('A database in one file.')).toMatchObject({ kind: 'invalid' })
		})
	})

	describe('EngineError', () => {
		it('exposes the kind of its failure', () => {
			const resetsAt = new Date('2026-11-19T08:00:00Z')
			const error = new EngineError({ kind: 'rate_limited', resetsAt }, 'Daily limit reached')

			expect({ name: error.name, kind: error.kind, failure: error.failure }).toEqual({
				name: 'EngineError',
				kind: 'rate_limited',
				failure: { kind: 'rate_limited', resetsAt },
			})
		})
	})
})
