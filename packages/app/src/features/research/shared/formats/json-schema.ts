// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { toJsonSchema, type JsonSchema } from '@valibot/to-json-schema'
import type * as v from 'valibot'

const derived = new WeakMap<v.GenericSchema, JsonSchema>()

/**
 * The JSON Schema an engine hands its provider, derived from the Valibot schema that validates the
 * answer, so the two cannot drift apart. Draft-07 is the dialect every provider accepts; an engine
 * strips the keywords its provider does not. `errorMode: 'throw'` makes a schema that JSON Schema
 * cannot express fail in the format specs instead of reaching an engine half-converted.
 */
export function deriveJsonSchema(schema: v.GenericSchema): JsonSchema {
	const cached = derived.get(schema)

	if (cached !== undefined) {
		return cached
	}

	const jsonSchema = toJsonSchema(schema, { target: 'draft-07', errorMode: 'throw' })

	derived.set(schema, jsonSchema)

	return jsonSchema
}
