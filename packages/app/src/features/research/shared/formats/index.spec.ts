// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { describe, expect, it } from 'bun:test'
import { cardFactories } from '#tests/factories/cards'
import { looseObjects } from '#tests/setup/json-schema'
import * as v from 'valibot'

import { formatIds } from '#/lib/format-ids'
import { deriveJsonSchema } from '#/lib/json-schema'

import { deeperLevel, handsOnLevel } from './common'
import { cardFormat, depths, formats } from './index'

const cases = formatIds.flatMap((id) => depths.map((depth) => [id, depth] as const))

/*
 * Each schema a card can use, once: the shared levels 2 and 3 back five formats, so snapshotting every
 * format and depth would repeat them and hide which change touched what.
 */
const distinctSchemas = [
	...formatIds.map((id) => [`${id} level 1`, formats[id].levels[1].schema] as const),
	['shared level 2', deeperLevel.schema],
	['shared level 3', handsOnLevel.schema],
	['vocabulary level 2', formats.vocabulary.levels[2].schema],
	['vocabulary level 3', formats.vocabulary.levels[3].schema],
	['report level 2', formats.report.levels[2].schema],
	['report level 3', formats.report.levels[3].schema],
] as const

describe('formats', () => {
	describe('cardFormat', () => {
		it.each(cases)('accepts a sample %s card at depth %d', (id, depth) => {
			const sample = cardFactories[id][depth].build()

			expect(v.safeParse(cardFormat(id, depth).schema, sample).issues).toBeUndefined()
		})

		it.each(cases)('rejects a %s card at depth %d with a field of the wrong type', (id, depth) => {
			const broken = { ...cardFactories[id][depth].build(), uncertain: 'maybe' }

			expect(v.is(cardFormat(id, depth).schema, broken)).toBe(false)
		})

		it.each(cases)('rejects a %s card at depth %d with a field it does not define', (id, depth) => {
			const broken = { ...cardFactories[id][depth].build(), confidence: 0.9 }

			expect(v.is(cardFormat(id, depth).schema, broken)).toBe(false)
		})

		it.each(cases)('rejects a %s card at depth %d with a source that is not HTTP', (id, depth) => {
			const sources = [{ title: 'Notes', url: 'ftp://example.com/notes' }]
			const broken = { ...cardFactories[id][depth].build(), sources }

			expect(v.is(cardFormat(id, depth).schema, broken)).toBe(false)
		})

		it.each(['gaps', 'approaches'] as const)('rejects a level 1 report without %s', (key) => {
			const { [key]: _missing, ...broken } = cardFactories.report[1].build()

			expect(v.is(cardFormat('report', 1).schema, broken)).toBe(false)
		})

		it('rejects a level 1 report whose approach is a string', () => {
			const broken = { ...cardFactories.report[1].build(), approaches: ['Parse it with rules.'] }

			expect(v.is(cardFormat('report', 1).schema, broken)).toBe(false)
		})

		it('joins the format and level instructions', () => {
			expect(cardFormat('concept', 2).instructions).toBe(
				`${formats.concept.instructions}\n\n${formats.concept.levels[2].instructions}`,
			)
		})
	})

	describe('JSON Schemas', () => {
		it('covers every schema a format uses at any depth', () => {
			const covered = new Set<v.GenericSchema>(distinctSchemas.map(([, schema]) => schema))

			expect(cases.filter(([id, depth]) => !covered.has(formats[id].levels[depth].schema))).toEqual(
				[],
			)
		})

		it.each(distinctSchemas)('derives the same JSON Schema for the %s', (_name, schema) => {
			expect(deriveJsonSchema(schema)).toMatchSnapshot()
		})

		it.each(distinctSchemas)('makes every object strict in the %s', (_name, schema) => {
			expect(looseObjects(deriveJsonSchema(schema))).toEqual([])
		})
	})
})
