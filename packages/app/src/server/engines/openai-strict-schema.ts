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

function adaptDefinition(definition: JsonSchema | boolean): JsonSchema | boolean {
	return definition === true || definition === false ? definition : strictSchema(definition)
}

/**
 * The derived JSON Schema as strict mode accepts it: without `$schema`, `minLength`, `maxLength`
 * and disallowed formats, in every schema under `properties`, `items` and `anyOf`. The caps stay in
 * the descriptions, and the Valibot schema still checks them.
 */
export function strictSchema(schema: JsonSchema): JsonSchema {
	// oxlint-disable-next-line no-unused-vars -- The stripped keywords are named only to leave them out.
	const { $schema, minLength, maxLength, format, properties, items, anyOf, ...kept } = schema
	const adapted: JsonSchema = kept

	if (format !== undefined && allowedFormats.has(format)) {
		adapted.format = format
	}

	if (properties !== undefined) {
		const entries = Object.entries(properties)

		adapted.properties = Object.fromEntries(
			entries.map(([name, property]) => [name, adaptDefinition(property)]),
		)
	}

	if (items !== undefined) {
		adapted.items = Array.isArray(items)
			? items.map((item) => adaptDefinition(item))
			: adaptDefinition(items)
	}

	if (anyOf !== undefined) {
		adapted.anyOf = anyOf.map((option) => adaptDefinition(option))
	}

	return adapted
}
