// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { describe, expect, it } from 'bun:test'
import { cardInputFactory, suggestInputFactory } from '#tests/factories/engine-input'

import { strictSchema } from './openai-strict-schema'

const rejected = /"(?:\$schema|minLength|maxLength)"|"format":"uri"/u

describe('strictSchema', () => {
	it('strips what strict mode rejects from a card and a suggestion', () => {
		const card = cardInputFactory.build().output.jsonSchema
		const suggestion = suggestInputFactory.build().output.jsonSchema

		expect(JSON.stringify(card)).toMatch(rejected)
		expect(JSON.stringify(strictSchema(card))).not.toMatch(rejected)
		expect(JSON.stringify(strictSchema(suggestion))).not.toMatch(rejected)
	})

	it('recurses into properties, items and anyOf and keeps everything else', () => {
		const schema = strictSchema({
			$schema: 'http://json-schema.org/draft-07/schema#',
			type: 'object',
			additionalProperties: false,
			required: ['sources', 'note'],
			properties: {
				sources: {
					type: 'array',
					maxItems: 5,
					items: { type: 'string', format: 'uri', maxLength: 2000, description: 'A page.' },
				},
				note: {
					anyOf: [{ type: 'string', minLength: 1, pattern: String.raw`^\S` }, { type: 'null' }],
				},
			},
		})

		expect(schema).toStrictEqual({
			type: 'object',
			additionalProperties: false,
			required: ['sources', 'note'],
			properties: {
				sources: { type: 'array', maxItems: 5, items: { type: 'string', description: 'A page.' } },
				note: { anyOf: [{ type: 'string', pattern: String.raw`^\S` }, { type: 'null' }] },
			},
		})
	})

	it('keeps a format strict mode allows', () => {
		expect(strictSchema({ type: 'string', format: 'date-time' })).toStrictEqual({
			type: 'string',
			format: 'date-time',
		})
	})
})
