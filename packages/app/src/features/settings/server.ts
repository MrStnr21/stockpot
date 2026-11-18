// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

/*
 * Runtime settings the owner changes in the app, one JSON value per section in the `settings` table.
 * A stored section is read as a patch over the defaults, so a missing row, or a field added after the
 * row was written, reads as its default.
 *
 * Engine keys and the agent command never leave the server: everything sent to a client goes through
 * `toPublicSettings`, which shows each one only as "set" or "not set". They are stored as plain text.
 * The nightly batch uses them unattended, so an encryption key would have to live on the same machine
 * as the database, and whoever can read the data directory could read both; the directory's
 * permissions and the owner's backups protect them instead (decided 2026-11-19).
 */
import { sql } from 'drizzle-orm'
import * as v from 'valibot'

import type { Db } from '#/server/db/client'
import { settings as settingsTable } from '#/server/db/schema/settings'
import type { Tier } from '#/server/engines/contract'

/** The engines in docs/engines.md, by the id the router and each card record. */
export const engineIds = ['agent-command', 'gemini', 'openai-compatible'] as const

export type EngineId = (typeof engineIds)[number]

const tiers = ['fast', 'standard', 'deep'] as const satisfies readonly Tier[]

function isTimeZone(value: string) {
	try {
		return new Intl.DateTimeFormat('en-US', { timeZone: value }).resolvedOptions().timeZone !== ''
	} catch {
		return false
	}
}

function textOrNull(maxLength: number) {
	return v.nullable(v.pipe(v.string(), v.trim(), v.nonEmpty(), v.maxLength(maxLength)))
}

/** An API key or the agent command: write-only, shown to clients as "set" or "not set". */
const secret = textOrNull(4096)

const modelId = textOrNull(200)

const clockTime = v.pipe(
	v.string(),
	v.regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/u, 'Use a 24-hour time, such as 08:30'),
)

const digestLimit = v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(50))

const timeZone = v.pipe(
	v.string(),
	v.check(isTimeZone, 'Use an IANA time zone, such as Europe/Berlin'),
)

const languageCode = v.pipe(
	v.string(),
	v.regex(/^[a-z]{2}$/u, 'Use a two-letter ISO 639-1 code, such as en'),
)

const baseUrl = v.nullable(
	v.pipe(v.string(), v.url(), v.regex(/^https?:\/\//u, 'Use an http or https URL')),
)

const engineId = v.picklist(engineIds)

const categoryId = v.pipe(v.string(), v.regex(/^[1-9]\d*$/u, 'Use a category id'))

const categoryRoute = v.object({ engine: engineId, tier: v.picklist(tiers) })

const fallbackOrder = v.pipe(
	v.array(engineId),
	v.check((ids) => new Set(ids).size === ids.length, 'List each engine once'),
)

const digestSchema = v.object({
	/** When the morning digest arrives, as HH:MM in `timeZone`. */
	time: clockTime,
	/** How many cards one digest holds at most. */
	limit: digestLimit,
	/** The IANA time zone the daily schedules fire in. */
	timeZone,
})

/** The model ID behind each tier; model IDs change often, so they live here and never in code. */
const modelsSchema = v.object({ fast: modelId, standard: modelId, deep: modelId })

const agentCommandSchema = v.object({
	/** The command line that runs the owner's agent; no vendor default ships (D3). */
	command: secret,
})

const geminiSchema = v.object({ apiKey: secret, models: modelsSchema })

const openAiCompatibleSchema = v.object({ baseUrl, apiKey: secret, models: modelsSchema })

const enginesSchema = v.object({
	'agent-command': agentCommandSchema,
	gemini: geminiSchema,
	'openai-compatible': openAiCompatibleSchema,
})

const routingSchema = v.object({
	/** Per-category overrides of the routing table in docs/engines.md, keyed by category id. */
	categories: v.record(categoryId, categoryRoute),
	/** The engines to try in turn on `rate_limited` or `auth`; unconfigured ones are skipped. */
	fallbackOrder,
})

const settingsSchema = v.object({
	digest: digestSchema,
	cardLanguage: languageCode,
	engines: enginesSchema,
	routing: routingSchema,
})

export type Settings = v.InferOutput<typeof settingsSchema>

const modelsPatch = v.partial(modelsSchema)

// A patch may name only some of an engine's models.
const geminiPatch = v.partial(v.object({ ...geminiSchema.entries, models: modelsPatch }))

const openAiCompatiblePatch = v.partial(
	v.object({ ...openAiCompatibleSchema.entries, models: modelsPatch }),
)

const enginesPatch = v.object({
	'agent-command': v.optional(v.partial(agentCommandSchema)),
	gemini: v.optional(geminiPatch),
	'openai-compatible': v.optional(openAiCompatiblePatch),
})

/**
 * A change to settings, and the shape a stored section is read in. A field left out keeps its value;
 * `null` clears a key or a model. `routing.categories` and `routing.fallbackOrder` are replaced whole.
 */
export const settingsPatchSchema = v.partial(
	v.object({
		digest: v.partial(digestSchema),
		cardLanguage: languageCode,
		engines: enginesPatch,
		routing: v.partial(routingSchema),
	}),
)

export type SettingsPatch = v.InferOutput<typeof settingsPatchSchema>

type SectionKey = keyof Settings

const sectionKeys: readonly SectionKey[] = ['digest', 'cardLanguage', 'engines', 'routing']

const noModels = { fast: null, standard: null, deep: null }

/** The settings of a new instance. The time zone defaults to the server's own. */
export function defaultSettings(): Settings {
	return {
		digest: {
			time: '08:30',
			limit: 5,
			timeZone: new Intl.DateTimeFormat().resolvedOptions().timeZone,
		},
		cardLanguage: 'en',
		engines: {
			'agent-command': { command: null },
			gemini: { apiKey: null, models: noModels },
			'openai-compatible': { baseUrl: null, apiKey: null, models: noModels },
		},
		routing: { categories: {}, fallbackOrder: ['gemini', 'openai-compatible'] },
	}
}

type Models = v.InferOutput<typeof modelsSchema>

function mergeEngine<TEngine extends { models: Models }>(
	engine: TEngine,
	patch: (Partial<Omit<TEngine, 'models'>> & { models?: Partial<Models> }) | undefined,
): TEngine {
	return { ...engine, ...patch, models: { ...engine.models, ...patch?.models } }
}

function applyPatch(settings: Settings, patch: SettingsPatch): Settings {
	const engines = patch.engines ?? {}

	return {
		digest: { ...settings.digest, ...patch.digest },
		cardLanguage: patch.cardLanguage ?? settings.cardLanguage,
		engines: {
			'agent-command': { ...settings.engines['agent-command'], ...engines['agent-command'] },
			gemini: mergeEngine(settings.engines.gemini, engines.gemini),
			'openai-compatible': mergeEngine(
				settings.engines['openai-compatible'],
				engines['openai-compatible'],
			),
		},
		routing: { ...settings.routing, ...patch.routing },
	}
}

function describeIssue(issue: v.BaseIssue<unknown>) {
	return `${v.getDotPath(issue) ?? 'settings'}: ${issue.message}`
}

/** Reads every section, falling back to the defaults; a stored value that no longer validates throws. */
export async function readSettings(db: Db): Promise<Settings> {
	const rows = await db.select().from(settingsTable)
	const stored = Object.fromEntries(rows.map((row) => [row.key, row.value]))
	const result = v.safeParse(settingsPatchSchema, stored)

	if (!result.success) {
		throw new Error(`Stored settings are invalid: ${result.issues.map(describeIssue).join('; ')}`)
	}

	return applyPatch(defaultSettings(), result.output)
}

/** Applies a validated patch and stores the sections it touches, in one statement. */
export async function updateSettings(db: Db, patch: SettingsPatch): Promise<Settings> {
	const next = applyPatch(await readSettings(db), patch)

	const rows = sectionKeys.flatMap((key) =>
		patch[key] === undefined ? [] : [{ key, value: next[key] }],
	)

	if (rows.length > 0) {
		await db
			.insert(settingsTable)
			.values(rows)
			.onConflictDoUpdate({
				target: settingsTable.key,
				set: { value: sql`excluded.value`, updatedAt: new Date() },
			})
	}

	return next
}

/**
 * The time zone daily schedules fire in. `server/` cannot import a feature, so whatever starts the
 * job runner (SRV-6) hands it `() => readTimeZone(db)`.
 */
export async function readTimeZone(db: Db): Promise<string> {
	const { digest } = await readSettings(db)

	return digest.timeZone
}

export type SecretState = 'set' | 'not set'

/** Settings as they may leave the server: every key and the agent command reduced to its state. */
export interface PublicSettings {
	digest: Settings['digest']
	cardLanguage: string
	engines: {
		'agent-command': { command: SecretState }
		gemini: { apiKey: SecretState; models: Models }
		'openai-compatible': { baseUrl: string | null; apiKey: SecretState; models: Models }
	}
	routing: Settings['routing']
}

function stateOf(value: string | null): SecretState {
	return value === null ? 'not set' : 'set'
}

/**
 * The one serializer for settings sent to a client. Each engine is rebuilt field by field, so a
 * field added to an engine later stays on the server until it is added here.
 */
export function toPublicSettings({
	digest,
	cardLanguage,
	engines,
	routing,
}: Settings): PublicSettings {
	const { gemini } = engines
	const openAiCompatible = engines['openai-compatible']

	return {
		digest,
		cardLanguage,
		engines: {
			'agent-command': { command: stateOf(engines['agent-command'].command) },
			gemini: { apiKey: stateOf(gemini.apiKey), models: gemini.models },
			'openai-compatible': {
				baseUrl: openAiCompatible.baseUrl,
				apiKey: stateOf(openAiCompatible.apiKey),
				models: openAiCompatible.models,
			},
		},
		routing,
	}
}
