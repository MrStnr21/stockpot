// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

/*
 * Engine settings (docs/engines.md, "Routing"): each engine's key and the model ID behind each tier,
 * per-category routing overrides and the fallback order. They live next to the contract so the router
 * (ENG-6) and the concrete engines can use them; the settings feature stores them with the rest.
 * The agent command is not among them: it comes from the environment (`config.agentCommand`), so
 * routing may name `agent-command`, but that engine is configured only when the variable is set.
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

/** An API key: write-only, shown to clients as "set" or "not set". */
const secret = textOrNull(4096)

const modelId = textOrNull(200)

/*
 * An endpoint is returned to clients as it is, so it may not carry a credential: no user name or
 * password, and no query or fragment, where some proxies take an API key. The key has its own field.
 */
function isPlainEndpoint(value: string) {
	// Valibot runs every check in the pipe; `v.url` already reports one that does not parse.
	if (!URL.canParse(value)) {
		return true
	}

	const url = new URL(value)

	return url.username === '' && url.password === '' && url.search === '' && url.hash === ''
}

const baseUrl = v.nullable(
	v.pipe(
		v.string(),
		v.url(),
		v.regex(/^https?:\/\//u, 'Use an http or https URL'),
		v.check(isPlainEndpoint, 'Leave credentials out of the URL; put the key in apiKey'),
	),
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

const requestCount = v.nullable(v.pipe(v.number(), v.integer(), v.minValue(1)))

const limitSchema = v.object({ perMinute: requestCount, perDay: requestCount })

/*
 * Gemini's request limits for each tier's model, below the quota Google sets for the key: the engine
 * refuses a call that would pass one (docs/engines.md, "The Gemini engine"). `null` sets no limit.
 */
const limitsSchema = v.object({ fast: limitSchema, standard: limitSchema, deep: limitSchema })

const geminiSchema = v.object({ apiKey: secret, models: modelsSchema, limits: limitsSchema })

const openAiCompatibleSchema = v.object({ baseUrl, apiKey: secret, models: modelsSchema })

export const enginesSchema = v.object({
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
const geminiPatch = v.partial(
	v.object({ ...geminiSchema.entries, models: modelsPatch, limits: v.partial(limitsSchema) }),
)

const openAiCompatiblePatch = v.partial(
	v.object({ ...openAiCompatibleSchema.entries, models: modelsPatch }),
)

/**
 * A change to the engines: a field left out keeps its value, `null` clears a key or a model, and a
 * tier named in Gemini's `limits` replaces that tier's limits.
 */
export const enginesPatchSchema = v.object({
	gemini: v.optional(geminiPatch),
	'openai-compatible': v.optional(openAiCompatiblePatch),
})

export type EnginesPatch = v.InferOutput<typeof enginesPatchSchema>

/** A change to routing: `categories` and `fallbackOrder` are each replaced whole. */
export const routingPatchSchema = v.partial(routingSchema)

const noModels = { fast: null, standard: null, deep: null }

/*
 * Gemini's tiers start on the models the owner's free key could use for each task on 2026-11-19
 * (docs/engines.md, "The Gemini engine"): search works only on Gemini 2.5 there. Settings change them.
 */
const geminiModels = {
	fast: 'gemini-3.1-flash-lite',
	standard: 'gemini-2.5-flash',
	deep: 'gemini-2.5-pro',
}

const noLimit = { perMinute: null, perDay: null }

const noLimits = { fast: noLimit, standard: noLimit, deep: noLimit }

/** No engine is configured on a new instance: Gemini has its models, but no key. */
export function defaultEngines(): EngineSettings {
	return {
		gemini: { apiKey: null, models: geminiModels, limits: noLimits },
		'openai-compatible': { baseUrl: null, apiKey: null, models: noModels },
	}
}

/** The "Falls back to" column of the routing table in docs/engines.md, with no overrides. */
export function defaultRouting(): Routing {
	return { categories: {}, fallbackOrder: ['gemini', 'openai-compatible'] }
}

type Models = v.InferOutput<typeof modelsSchema>

type Limits = v.InferOutput<typeof limitsSchema>

function mergeEngine<TEngine extends { models: Models }>(
	engine: TEngine,
	patch: (Partial<Omit<TEngine, 'models' | 'limits'>> & { models?: Partial<Models> }) | undefined,
): TEngine {
	return { ...engine, ...patch, models: { ...engine.models, ...patch?.models } }
}

export function applyEnginesPatch(engines: EngineSettings, patch: EnginesPatch): EngineSettings {
	return {
		gemini: {
			...mergeEngine(engines.gemini, patch.gemini),
			limits: { ...engines.gemini.limits, ...patch.gemini?.limits },
		},
		'openai-compatible': mergeEngine(engines['openai-compatible'], patch['openai-compatible']),
	}
}

export type SecretState = 'set' | 'not set'

/**
 * The engines that can take a call: the agent command when its variable is set, Gemini with a key,
 * and an OpenAI-compatible endpoint with a base URL (a local model may need no key). The router
 * skips the rest, in routing and in the fallback order.
 */
export function configuredEngines(
	engines: EngineSettings,
	agentCommand: string | null,
): EngineId[] {
	const isConfigured = {
		'agent-command': agentCommand !== null,
		gemini: engines.gemini.apiKey !== null,
		'openai-compatible': engines['openai-compatible'].baseUrl !== null,
	} satisfies Record<EngineId, boolean>

	return engineIds.filter((id) => isConfigured[id])
}

/** Engine settings as they may leave the server: each key, and the agent command, as its state. */
export interface PublicEngines {
	'agent-command': { command: SecretState }
	gemini: { apiKey: SecretState; models: Models; limits: Limits }
	'openai-compatible': { baseUrl: string | null; apiKey: SecretState; models: Models }
}

function stateOf(value: string | null): SecretState {
	return value === null ? 'not set' : 'set'
}

/**
 * Rebuilds each engine field by field, so a field added to an engine later stays on the server
 * until it is added here. The settings feature's `toPublicSettings` is its only caller.
 */
export function toPublicEngines(
	engines: EngineSettings,
	agentCommand: string | null,
): PublicEngines {
	const { gemini } = engines
	const openAiCompatible = engines['openai-compatible']

	return {
		'agent-command': { command: stateOf(agentCommand) },
		gemini: { apiKey: stateOf(gemini.apiKey), models: gemini.models, limits: gemini.limits },
		'openai-compatible': {
			baseUrl: openAiCompatible.baseUrl,
			apiKey: stateOf(openAiCompatible.apiKey),
			models: openAiCompatible.models,
		},
	}
}
