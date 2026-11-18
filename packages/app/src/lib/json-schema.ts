// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

/*
 * Valibot schemas for engine output and the JSON Schema derived from them (docs/engines.md, "Defining
 * a format once"). The card formats and the suggestion schema are built from these helpers, so every
 * field converts to JSON Schema and reads the same way to a model.
 */
import { toJsonSchema, type JsonSchema } from '@valibot/to-json-schema'
import * as v from 'valibot'

type BoundedString = v.SchemaWithPipe<
	readonly [
		v.StringSchema<undefined>,
		v.NonEmptyAction<string, undefined>,
		v.MaxLengthAction<string, number, undefined>,
	]
>

type Described<TSchema extends v.GenericSchema> = v.SchemaWithPipe<
	readonly [TSchema, v.DescriptionAction<v.InferOutput<TSchema>, string>]
>

export type List<TItem extends v.GenericSchema> = v.SchemaWithPipe<
	readonly [
		v.ArraySchema<TItem, undefined>,
		v.MinLengthAction<v.InferOutput<TItem>[], number, undefined>,
		v.MaxLengthAction<v.InferOutput<TItem>[], number, undefined>,
		v.DescriptionAction<v.InferOutput<TItem>[], string>,
	]
>

function boundedString(maxLength: number): BoundedString {
	return v.pipe(v.string(), v.nonEmpty(), v.maxLength(maxLength))
}

/** A string the engine must fill, capped so that a card stays short enough for a phone. */
export function text(maxLength: number, description: string): Described<BoundedString> {
	return v.pipe(boundedString(maxLength), v.description(description))
}

/** Like `text`, but `null` when there is nothing worth saying. */
export function textOrNull(
	maxLength: number,
	description: string,
): Described<v.NullableSchema<BoundedString, undefined>> {
	const nullable = v.nullable(boundedString(maxLength))

	return v.pipe(nullable, v.description(description))
}

/** A list of `item`, from `min` to `max` long. */
export function list<TItem extends v.GenericSchema>(
	item: TItem,
	{ min, max }: { min: number; max: number },
	description: string,
): List<TItem> {
	return v.pipe(v.array(item), v.minLength(min), v.maxLength(max), v.description(description))
}

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
