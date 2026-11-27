// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

/*
 * What `PATCH /api/settings` accepts: the stored patch shape, strict at every level so a misspelt
 * field is a 400 rather than a change that silently does nothing. It leaves out what the owner may not
 * change over HTTP here: Gemini's limits (not editable yet) and the per-category routes, which change
 * one at a time through `PUT /api/categories/:id/engine`, so a stale page cannot overwrite them.
 */
import * as v from 'valibot'

import { digestSchema, languageCode } from '#/features/settings/server'
import { enginesPatchSchema, routingSchema } from '#/server/engines/settings'

const { gemini, 'openai-compatible': openAiCompatible } = enginesPatchSchema.entries

const geminiEntries = gemini.wrapped.entries

const openAiCompatibleEntries = openAiCompatible.wrapped.entries

/*
 * Valibot's default messages quote some invalid values, such as a key sent as a number. These
 * replace every message of the field, so no issue ever repeats what was submitted.
 */
const apiKey = v.message(geminiEntries.apiKey, 'Use a key of 1 to 4096 characters, or null')

const baseUrl = v.message(openAiCompatibleEntries.baseUrl, 'Use an http or https URL, or null')

const models = v.optional(v.strictObject(geminiEntries.models.wrapped.entries))

const enginesChange = v.strictObject({
	gemini: v.optional(v.strictObject({ apiKey, models })),
	'openai-compatible': v.optional(v.strictObject({ baseUrl, apiKey, models })),
})

const digestChange = v.partial(v.strictObject(digestSchema.entries))

const routingChange = v.strictObject({ fallbackOrder: routingSchema.entries.fallbackOrder })

const sections = v.partial(
	v.strictObject({
		digest: digestChange,
		cardLanguage: languageCode,
		engines: enginesChange,
		routing: routingChange,
	}),
)

/** A change from the settings page: at least one section, each field optional. */
export const settingsChangeSchema = v.pipe(
	sections,
	v.check((change) => Object.keys(change).length > 0, 'Change at least one setting'),
)

export type SettingsChange = v.InferOutput<typeof settingsChangeSchema>
