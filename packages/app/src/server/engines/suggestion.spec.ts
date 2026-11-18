// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { describe, expect, it } from 'bun:test'
import { looseObjects } from '#tests/setup/json-schema'
import * as v from 'valibot'

import { suggestionFormat, type Suggestion } from './suggestion'

const categoryIds = ['english', 'technology', 'other']

const sabr = {
	categories: ['technology', 'other'],
	senses: [
		{ sense: 'Video streaming protocol', category: 'technology' },
		{ sense: 'Baseball statistics', category: 'other' },
	],
	language: 'en',
} satisfies Suggestion

describe('suggestionFormat', () => {
	it('accepts a suggestion with senses for an ambiguous term', () => {
		expect(v.safeParse(suggestionFormat(categoryIds).schema, sabr).issues).toBeUndefined()
	})

	it('rejects a category that is not in the list', () => {
		const unknownCategory = { ...sabr, categories: ['cooking'] }

		expect(v.is(suggestionFormat(categoryIds).schema, unknownCategory)).toBe(false)
	})

	it('rejects a suggestion without categories', () => {
		expect(v.is(suggestionFormat(categoryIds).schema, { ...sabr, categories: [] })).toBe(false)
	})

	it('rejects more than three categories', () => {
		const tooMany = { ...sabr, categories: [...categoryIds, 'english'] }

		expect(v.is(suggestionFormat(categoryIds).schema, tooMany)).toBe(false)
	})

	it('derives the same JSON Schema, with the category ids as an enum', () => {
		expect(suggestionFormat(categoryIds).jsonSchema).toMatchSnapshot()
	})

	it('rejects a language code that is not lowercase', () => {
		expect(v.is(suggestionFormat(categoryIds).schema, { ...sabr, language: 'EN' })).toBe(false)
	})

	it('lists each category id once', () => {
		const schema = suggestionFormat([...categoryIds, 'english']).jsonSchema

		expect(schema).toMatchObject({
			properties: { categories: { items: { enum: categoryIds } } },
		})
	})

	it('refuses to build a suggestion without categories', () => {
		expect(() => suggestionFormat([])).toThrow('at least one category')
	})

	it('makes every object in its JSON Schema strict', () => {
		expect(looseObjects(suggestionFormat(categoryIds).jsonSchema)).toEqual([])
	})
})
