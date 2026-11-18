// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { describe, expect, it } from 'bun:test'
import { toJsonSchema } from '@valibot/to-json-schema'
import * as v from 'valibot'

import { looseObjects } from './json-schema'

describe('looseObjects', () => {
	it('finds nothing in an object that is strict all the way down', () => {
		const tag = v.strictObject({ name: v.string() })
		const strict = v.strictObject({ tags: v.array(tag) })

		expect(looseObjects(toJsonSchema(strict))).toEqual([])
	})

	it('finds an object that allows properties it does not list', () => {
		const loose = v.strictObject({ owner: v.object({ name: v.string() }) })

		expect(looseObjects(toJsonSchema(loose))).toEqual(['#/properties/owner'])
	})

	it('finds an object with an optional property, inside a nullable list', () => {
		const optional = v.strictObject({ name: v.optional(v.string()) })
		const schema = v.strictObject({ items: v.nullable(v.array(optional)) })

		expect(looseObjects(toJsonSchema(schema))).toEqual(['#/properties/items/anyOf/0/items/0'])
	})
})
