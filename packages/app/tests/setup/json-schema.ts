// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import type { JsonSchema } from '@valibot/to-json-schema'

// A JSON Schema definition is a schema or `true` / `false`.
type Definition = JsonSchema | boolean

function listsEvery(required: readonly string[], keys: readonly string[]): boolean {
	return required.length === keys.length && keys.every((key) => required.includes(key))
}

function isLoose(schema: JsonSchema): boolean {
	const keys = Object.keys(schema.properties ?? {})

	return (
		schema.type === 'object' &&
		(schema.additionalProperties !== false || !listsEvery(schema.required ?? [], keys))
	)
}

/**
 * The paths of the objects in `schema` that strict structured-output modes would refuse: one that
 * allows properties it does not list, or leaves a listed one optional. Empty when all are strict.
 */
export function looseObjects(schema: JsonSchema, path = '#'): string[] {
	const items = schema.items === undefined ? [] : [schema.items].flat()

	const children: [string, Definition][] = [
		...Object.entries(schema.properties ?? {}).map(([key, child]): [string, Definition] => [
			`${path}/properties/${key}`,
			child,
		]),
		...items.map((child, index): [string, Definition] => [`${path}/items/${index}`, child]),
		...(schema.anyOf ?? []).map((child, index): [string, Definition] => [
			`${path}/anyOf/${index}`,
			child,
		]),
	]

	// A JSON Schema definition may also be `true` or `false`; derived schemas never use them.
	const nested = children.flatMap(([childPath, child]) =>
		child === true || child === false ? [] : looseObjects(child, childPath),
	)

	return isLoose(schema) ? [path, ...nested] : nested
}
