// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

/*
 * The OpenAI-compatible engine's schema adaptation (docs/engines.md, "Provider schemas"), apart from
 * the engine so that it stays a pure function with its own spec. Only `openai-compatible.ts` uses it.
 */
import type { JsonSchema } from '@valibot/to-json-schema'

/* Strict structured output rejects `$schema`, `minLength`, `maxLength` and any format outside this
 * list, which leaves out the `uri` our sources use (docs/engines.md, "Provider schemas"). */
const allowedFormats = new Set([
	'date-time',
	'time',
	'date',
	'duration',
	'email',
	'hostname',
	'ipv4',
	'ipv6',
	'uuid',
])

type Definition = JsonSchema | boolean

function adaptDefinition(definition: Definition): Definition {
	return definition === true || definition === false ? definition : strictSchema(definition)
}

function adaptList(definitions: readonly Definition[]): Definition[] {
	return definitions.map((definition) => adaptDefinition(definition))
}

function adaptMap(definitions: Readonly<Record<string, Definition>>): Record<string, Definition> {
	const entries = Object.entries(definitions)

	return Object.fromEntries(
		entries.map(([name, definition]) => [name, adaptDefinition(definition)]),
	)
}

/**
 * The derived JSON Schema as strict mode accepts it: without `$schema`, `minLength`, `maxLength`
 * and disallowed formats, in every schema under `properties`, `$defs`, `items`,
 * `additionalProperties`, `anyOf`, `allOf` and `oneOf`. The caps stay in the descriptions, and the
 * Valibot schema still checks them.
 */
export function strictSchema(schema: JsonSchema): JsonSchema {
	// oxlint-disable-next-line no-unused-vars -- The stripped keywords are named only to leave them out.
	const { $schema, minLength, maxLength, format, ...rest } = schema
	const { properties, $defs, items, additionalProperties, anyOf, allOf, oneOf, ...kept } = rest
	const adapted: JsonSchema = kept

	if (format !== undefined && allowedFormats.has(format)) {
		adapted.format = format
	}

	if (properties !== undefined) {
		adapted.properties = adaptMap(properties)
	}

	if ($defs !== undefined) {
		adapted.$defs = adaptMap($defs)
	}

	if (items !== undefined) {
		adapted.items = Array.isArray(items) ? adaptList(items) : adaptDefinition(items)
	}

	if (additionalProperties !== undefined) {
		adapted.additionalProperties = adaptDefinition(additionalProperties)
	}

	if (anyOf !== undefined) {
		adapted.anyOf = adaptList(anyOf)
	}

	if (allOf !== undefined) {
		adapted.allOf = adaptList(allOf)
	}

	if (oneOf !== undefined) {
		adapted.oneOf = adaptList(oneOf)
	}

	return adapted
}
