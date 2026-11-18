// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { describe, expect, it } from 'bun:test'
import type { JsonSchema } from '@valibot/to-json-schema'
import { cardFactories } from '#tests/factories/cards'
import * as v from 'valibot'

import { formatIds } from '#/lib/format-ids'

import { cardFormat, depths, formats } from './index'

const cases = formatIds.flatMap((id) => depths.map((depth) => [id, depth] as const))

/** Every object schema in `schema`, itself included. */
function objectNodes(schema: JsonSchema): JsonSchema[] {
	const items = schema.items === undefined ? [] : [schema.items].flat()
	const children = [...Object.values(schema.properties ?? {}), ...items, ...(schema.anyOf ?? [])]
	const own = schema.type === 'object' ? [schema] : []
	// A JSON Schema definition may also be `true` or `false`; the derived ones never are.
	const childSchemas = children.filter((child) => child !== true && child !== false)

	return [...own, ...childSchemas.flatMap((child) => objectNodes(child))]
}

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

		it.each(cases)('derives the same JSON Schema for %s at depth %d', (id, depth) => {
			expect(cardFormat(id, depth).jsonSchema).toMatchSnapshot()
		})

		it.each(cases)('makes every object strict in the %s schema at depth %d', (id, depth) => {
			const nodes = objectNodes(cardFormat(id, depth).jsonSchema)

			expect(nodes.map((node) => node.additionalProperties)).toEqual(nodes.map(() => false))
			expect(nodes.map((node) => node.required)).toEqual(
				nodes.map((node) => Object.keys(node.properties ?? {})),
			)
		})

		it('joins the format and level instructions', () => {
			expect(cardFormat('concept', 2).instructions).toBe(
				`${formats.concept.instructions}\n\n${formats.concept.levels[2].instructions}`,
			)
		})
	})
})
