// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { describe, expect, it } from 'bun:test'
import { faker } from '@faker-js/faker'
import { categoryRowFactory } from '#tests/factories/categories'
import * as v from 'valibot'

import {
	categoryChangeSchema,
	categoryIdSchema,
	categoryOrderSchema,
	newCategorySchema,
} from './schemas'

const category = categoryRowFactory.params({ icon: 'leaf', color: 'concept' })

describe('category schemas', () => {
	it('trims the name and instructions and accepts their maximum lengths', () => {
		const name = faker.string.alpha(40)
		const instructions = faker.string.alpha(2000)
		const fields = category.build({ name: `  ${name}  `, instructions: `\n${instructions}\n` })

		expect(v.parse(newCategorySchema, fields)).toMatchObject({ name, instructions })
	})

	it('defaults missing instructions to blank on creation and preserves omissions on edit', () => {
		expect(v.parse(newCategorySchema, category.build()).instructions).toBe('')
		expect(v.parse(categoryChangeSchema, { icon: 'flag' })).toEqual({ icon: 'flag' })
		expect(v.parse(categoryChangeSchema, { instructions: ' \n ' })).toEqual({ instructions: '' })
	})

	it.each([
		['blank name', { name: ' \t' }],
		['long name', { name: faker.string.alpha(41) }],
		['unknown icon', { icon: 'missing' }],
		['unknown color', { color: 'missing' }],
		['unknown format', { format: 'missing' }],
		['long instructions', { instructions: faker.string.alpha(2001) }],
		['position', { position: 1 }],
	])('rejects %s on both create and edit', (_case, fields) => {
		expect(v.safeParse(newCategorySchema, { ...category.build(), ...fields }).success).toBe(false)
		expect(v.safeParse(categoryChangeSchema, fields).success).toBe(false)
	})

	it('requires a name, icon, color and format on creation and a change on edit', () => {
		const fields = category.build()

		for (const key of ['name', 'icon', 'color', 'format'] as const) {
			expect(v.safeParse(newCategorySchema, { ...fields, [key]: undefined }).success).toBe(false)
		}

		expect(v.safeParse(categoryChangeSchema, {}).success).toBe(false)
	})

	it('accepts only positive safe integer ids for paths, move targets and ordering', () => {
		expect(v.parse(categoryIdSchema, '12')).toBe(12)

		for (const id of ['0', '01', '-1', '1.5', '1e2', '9007199254740992']) {
			expect(v.safeParse(categoryIdSchema, id).success).toBe(false)
		}

		for (const id of [0, 1.5, '1', Number.MAX_SAFE_INTEGER + 1]) {
			expect(v.safeParse(categoryOrderSchema, { ids: [id] }).success).toBe(false)
		}
	})
})
