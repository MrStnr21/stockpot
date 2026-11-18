// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

/*
 * Engine settings (docs/engines.md, "Routing"): each engine's key and the model ID behind each tier,
 * per-category routing overrides and the fallback order. They live next to the contract so the router
 * (ENG-6) and the concrete engines can use them; the settings feature stores them with the rest.
 */
import * as v from 'valibot'

import type { Tier } from './contract'

/** The engines in docs/engines.md, by the id the router and each card record. */
export const engineIds = ['agent-command', 'gemini', 'openai-compatible'] as const

export type EngineId = (typeof engineIds)[number]

const tiers = ['fast', 'standard', 'deep'] as const satisfies readonly Tier[]

function textOrNull(maxLength: number) {
	return v.nullable(v.pipe(v.string(), v.trim(), v.nonEmpty(), v.maxLength(maxLength)))
}

/** An API key or the agent command: write-only, shown to clients as "set" or "not set". */
const secret = textOrNull(4096)

const modelId = textOrNull(200)

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

/** The model ID behind each tier; model IDs change often, so they live in settings, never in code. */
const modelsSchema = v.object({ fast: modelId, standard: modelId, deep: modelId })

const agentCommandSchema = v.object({
	/** The command line that runs the owner's agent; no vendor default ships (D3). */
	command: secret,
})

const geminiSchema = v.object({ apiKey: secret, models: modelsSchema })

const openAiCompatibleSchema = v.object({ baseUrl, apiKey: secret, models: modelsSchema })

export const enginesSchema = v.object({
	'agent-command': agentCommandSchema,
	gemini: geminiSchema,
	'openai-compatible': openAiCompatibleSchema,
})

export type EngineSettings = v.InferOutput<typeof enginesSchema>

export const routingSchema = v.object({
	/** Per-category overrides of the routing table in docs/engines.md, keyed by category id. */
	categories: v.record(categoryId, categoryRoute),
	/** The engines to try in turn on `rate_limited` or `auth`; unconfigured ones are skipped. */
	fallbackOrder,
})

export type Routing = v.InferOutput<typeof routingSchema>

const modelsPatch = v.partial(modelsSchema)

// A patch may name only some of an engine's models.
const geminiPatch = v.partial(v.object({ ...geminiSchema.entries, models: modelsPatch }))

const openAiCompatiblePatch = v.partial(
	v.object({ ...openAiCompatibleSchema.entries, models: modelsPatch }),
)

/** A change to the engines: a field left out keeps its value, `null` clears a key or a model. */
export const enginesPatchSchema = v.object({
	'agent-command': v.optional(v.partial(agentCommandSchema)),
	gemini: v.optional(geminiPatch),
	'openai-compatible': v.optional(openAiCompatiblePatch),
})

export type EnginesPatch = v.InferOutput<typeof enginesPatchSchema>

/** A change to routing: `categories` and `fallbackOrder` are each replaced whole. */
export const routingPatchSchema = v.partial(routingSchema)

const noModels = { fast: null, standard: null, deep: null }

/** No engine is configured on a new instance. */
export function defaultEngines(): EngineSettings {
	return {
		'agent-command': { command: null },
		gemini: { apiKey: null, models: noModels },
		'openai-compatible': { baseUrl: null, apiKey: null, models: noModels },
	}
}

/** The "Falls back to" column of the routing table in docs/engines.md, with no overrides. */
export function defaultRouting(): Routing {
	return { categories: {}, fallbackOrder: ['gemini', 'openai-compatible'] }
}

type Models = v.InferOutput<typeof modelsSchema>

function mergeEngine<TEngine extends { models: Models }>(
	engine: TEngine,
	patch: (Partial<Omit<TEngine, 'models'>> & { models?: Partial<Models> }) | undefined,
): TEngine {
	return { ...engine, ...patch, models: { ...engine.models, ...patch?.models } }
}

export function applyEnginesPatch(engines: EngineSettings, patch: EnginesPatch): EngineSettings {
	return {
		'agent-command': { ...engines['agent-command'], ...patch['agent-command'] },
		gemini: mergeEngine(engines.gemini, patch.gemini),
		'openai-compatible': mergeEngine(engines['openai-compatible'], patch['openai-compatible']),
	}
}

export type SecretState = 'set' | 'not set'

/** Engine settings as they may leave the server: every key reduced to its state. */
export interface PublicEngines {
	'agent-command': { command: SecretState }
	gemini: { apiKey: SecretState; models: Models }
	'openai-compatible': { baseUrl: string | null; apiKey: SecretState; models: Models }
}

function stateOf(value: string | null): SecretState {
	return value === null ? 'not set' : 'set'
}

/**
 * Rebuilds each engine field by field, so a field added to an engine later stays on the server
 * until it is added here. The settings feature's `toPublicSettings` is its only caller.
 */
export function toPublicEngines(engines: EngineSettings): PublicEngines {
	const { gemini } = engines
	const openAiCompatible = engines['openai-compatible']

	return {
		'agent-command': { command: stateOf(engines['agent-command'].command) },
		gemini: { apiKey: stateOf(gemini.apiKey), models: gemini.models },
		'openai-compatible': {
			baseUrl: openAiCompatible.baseUrl,
			apiKey: stateOf(openAiCompatible.apiKey),
			models: openAiCompatible.models,
		},
	}
}
