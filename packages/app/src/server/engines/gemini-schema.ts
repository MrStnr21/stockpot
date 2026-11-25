// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

/*
 * How the Gemini engine asks for structured output (docs/engines.md, "The Gemini engine"), apart from
 * the engine so that the research loop can ask the same way. Only the Gemini modules use it.
 */
import type { GenerateContentConfig } from '@google/genai'
import type { JsonSchema } from '@valibot/to-json-schema'

import type { OutputFormat } from './contract'

/**
 * The derived JSON Schema as `responseJsonSchema` takes it. The recorded responses show it taking
 * `pattern`, `format: uri`, `anyOf` and nullable types as derived; probes on 2026-11-19 saw it take
 * `$schema` too, which it does not use, so only that is left out. `responseSchema` is not used:
 * probes saw it reject `$schema` and `additionalProperties`.
 */
export function geminiSchema(schema: JsonSchema): JsonSchema {
	// oxlint-disable-next-line no-unused-vars -- The stripped keyword is named only to leave it out.
	const { $schema, ...rest } = schema

	return rest
}

/** The request config that makes the answer JSON of the format's schema. */
export function structured(output: OutputFormat): GenerateContentConfig {
	return {
		responseMimeType: 'application/json',
		responseJsonSchema: geminiSchema(output.jsonSchema),
	}
}
