// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

/*
 * The engine router (docs/engines.md, "Routing"): the one entry point from the product to the
 * language models. It picks the engine and tier for a task and category, from the routing table's
 * defaults and the owner's per-category overrides, redacts the input once and falls back along the
 * configured engines on `rate_limited` or `auth`. It never stores a card or queues a job, which
 * belong to the research feature: a card from a fallback engine comes back as a draft with the time
 * to redo it, and the feature queues the redo.
 */
import type * as v from 'valibot'

import type { FormatId } from '#/lib/format-ids'
import type { Db } from '#/server/db/client'

import { createAgentCommandEngine } from './agent-cli'
import {
	defaultTimeoutMs,
	EngineError,
	redactPrivate,
	type CardInput,
	type Engine,
	type EngineResult,
	type RunOptions,
	type SuggestInput,
	type Task,
	type Tier,
} from './contract'
import { createGeminiEngine } from './gemini'
import { createOpenAiCompatibleEngine } from './openai-compatible'
import { configuredEngines, type EngineId, type EngineSettings, type Routing } from './settings'

/** Every row of the routing table starts on Gemini; an owner routes a category elsewhere in settings. */
const defaultEngine = 'gemini' satisfies EngineId

/** What settings say about the engines and routing at the time of a call. */
export interface RouterSettings {
	readonly engines: EngineSettings
	readonly routing: Routing
}

export interface RouteRequest {
	readonly task: Task
	/** The id of the call's output format: a card format, or `suggestion`. */
	readonly format: string
	/** The category a card is for, which settings may route away from its format's row. */
	readonly categoryId: number | null
}

export interface Route {
	readonly tier: Tier
	/** The engines to try in turn, configured ones only: the first is the primary engine. */
	readonly path: readonly EngineId[]
}

/** The tier column of the routing table, keyed by task and format. */
export function defaultTier(task: Task, format: string): Tier {
	if (task === 'suggest') {
		return 'fast'
	}

	if (task === 'research') {
		return 'deep'
	}

	return format === ('vocabulary' satisfies FormatId) ? 'fast' : 'standard'
}

/**
 * The engine and tier for a call, then the engines to fall back to in the configured order. An
 * engine that is not configured is skipped, the routed one included: the first configured engine is
 * then the primary. A suggestion has no category, so it always takes its row. `research` never falls
 * back, because the OpenAI-compatible engine writes from text only and cannot search: the job waits
 * for the primary engine's reset instead.
 */
export function resolveRoute(
	{ task, format, categoryId }: RouteRequest,
	{ engines, routing }: RouterSettings,
	agentCommand: string | null,
): Route {
	const override =
		task === 'suggest' || categoryId === null ? undefined : routing.categories[String(categoryId)]

	const primary = override?.engine ?? defaultEngine
	const configured = new Set(configuredEngines(engines, agentCommand))

	const candidates = [primary, ...routing.fallbackOrder.filter((id) => id !== primary)].filter(
		(id) => configured.has(id),
	)

	return {
		tier: override?.tier ?? defaultTier(task, format),
		path: task === 'research' ? candidates.slice(0, 1) : candidates,
	}
}

/** The engines of the process, each built once; the agent command has none when it is not set. */
export type EngineSet = Readonly<Record<EngineId, Engine | null>>

export interface EngineSetOptions {
	readonly db: Db
	/** Settings, read at every call so that a change applies to the next one. */
	readonly settings: () => RouterSettings
	/** The owner's agent command template, `config.agentCommand`. */
	readonly agentCommand: string | null
}

/**
 * Builds each engine once, so Gemini's per-model counters, seeded from `engine_runs`, hold across
 * calls. Throws when the agent command template cannot be parsed.
 */
export function createEngines({ db, settings, agentCommand }: EngineSetOptions): EngineSet {
	return {
		'agent-command':
			agentCommand === null ? null : createAgentCommandEngine({ command: agentCommand, db }),
		gemini: createGeminiEngine({ db, settings: () => settings().engines.gemini }),
		'openai-compatible': createOpenAiCompatibleEngine({
			db,
			settings: () => settings().engines['openai-compatible'],
		}),
	}
}

// The call options an engine receives as they are, plus the timeout, which defaults per task.
export interface RouteOptions extends Pick<RunOptions, 'signal' | 'jobId' | 'onProgress'> {
	readonly timeoutMs?: number
}

export interface CardRouteOptions extends RouteOptions {
	readonly categoryId: number
}

/**
 * A card from the primary engine, or a draft from a fallback engine while the primary one was
 * limited. The research feature stores a draft as such and queues its redo for `redoAt`, the primary
 * engine's reset, when the router sends the same call to the primary engine again. A card written by
 * a fallback engine because the primary one rejected its key is not a draft: there is no reset to
 * wait for.
 */
export type CardResult<TOutput> = EngineResult<TOutput> &
	({ readonly draft: false } | { readonly draft: true; readonly redoAt: Date })

type RouteCard<TTask extends 'explain' | 'research'> = <TSchema extends v.GenericSchema>(
	input: CardInput<TTask, TSchema>,
	options: CardRouteOptions,
) => Promise<CardResult<v.InferOutput<TSchema>>>

/** Calls the engines for the product. A suggestion is never a draft: it is shown, not stored. */
export interface Router {
	readonly suggest: <TSchema extends v.GenericSchema>(
		input: SuggestInput<TSchema>,
		options?: RouteOptions,
	) => Promise<EngineResult<v.InferOutput<TSchema>>>
	readonly explain: RouteCard<'explain'>
	readonly research: RouteCard<'research'>
}

export interface RouterOptions extends EngineSetOptions {
	/** Builds the engines, once per router; specs pass fakes. */
	readonly build?: (options: EngineSetOptions) => EngineSet
}

interface Answer<TOutput> {
	readonly result: EngineResult<TOutput>
	readonly redoAt: Date | null
}

type Call<TOutput> = (engine: Engine, options: RunOptions) => Promise<EngineResult<TOutput>>

type Outcome<TOutput> =
	{ readonly result: EngineResult<TOutput> } | { readonly failure: EngineError }

function cardRequest(input: CardInput, { categoryId }: CardRouteOptions): RouteRequest {
	return { task: input.task, format: input.output.id, categoryId }
}

function toCard<TOutput>({ result, redoAt }: Answer<TOutput>): CardResult<TOutput> {
	return redoAt === null ? { ...result, draft: false } : { ...result, draft: true, redoAt }
}

/** Build one router per process and share it, so each engine and its counters exist once. */
export function createRouter({
	db,
	settings,
	agentCommand,
	build = createEngines,
}: RouterOptions): Router {
	const engines = build({ db, settings, agentCommand })

	/* Gemini counts requests per model, so a limit holds for one tier's model, not for the engine's
	 * other tiers. Kept in memory: after a restart, the first call finds the limit again. */
	const limits = new Map<`${EngineId}:${Tier}`, Date>()

	function limitedUntil(id: EngineId, tier: Tier): Date | null {
		const resetsAt = limits.get(`${id}:${tier}`) ?? null

		return resetsAt !== null && resetsAt.getTime() > Date.now() ? resetsAt : null
	}

	/*
	 * A limited engine is remembered and skipped, without a call, until its reset. A rejected key is
	 * not remembered, so a fixed key works on the next call. Any other failure is thrown at once, for
	 * the job runner to retry on the same engine.
	 */
	async function attempt<TOutput>(
		id: EngineId,
		options: RunOptions,
		call: Call<TOutput>,
	): Promise<Outcome<TOutput>> {
		const engine = engines[id]
		const resetsAt = limitedUntil(id, options.tier)

		if (resetsAt !== null) {
			const message = `The ${id} engine is limited until ${resetsAt.toISOString()}`

			return { failure: new EngineError({ kind: 'rate_limited', resetsAt }, message) }
		}

		if (engine === null) {
			throw new Error(`The ${id} engine is configured but was not built`)
		}

		try {
			return { result: await call(engine, options) }
		} catch (error) {
			if (!(error instanceof EngineError && ['rate_limited', 'auth'].includes(error.kind))) {
				throw error
			}

			if (error.failure.kind === 'rate_limited') {
				limits.set(`${id}:${options.tier}`, error.failure.resetsAt)
			}

			return { failure: error }
		}
	}

	/** Tries the path in turn; with none left, throws the primary's failure and its `resetsAt`. */
	async function route<TOutput>(
		request: RouteRequest,
		{ timeoutMs = defaultTimeoutMs[request.task], signal, jobId, onProgress }: RouteOptions,
		call: Call<TOutput>,
	): Promise<Answer<TOutput>> {
		const { tier, path } = resolveRoute(request, settings(), agentCommand)
		const options: RunOptions = { tier, timeoutMs, signal, jobId, onProgress }
		let primaryFailure: EngineError | null = null

		for (const id of path) {
			// oxlint-disable-next-line no-await-in-loop -- Each engine is tried only after the one before it failed.
			const outcome = await attempt(id, options, call)

			if ('result' in outcome) {
				const primary = primaryFailure?.failure
				const redoAt = primary?.kind === 'rate_limited' ? primary.resetsAt : null

				return { result: outcome.result, redoAt }
			}

			// Every engine before this one failed too, so the first failure is the primary engine's.
			primaryFailure ??= outcome.failure
		}

		throw primaryFailure ?? new Error(`No engine is configured for ${request.task}`)
	}

	return {
		suggest: async (input, options = {}) => {
			const redacted = redactPrivate(input)
			const request = { task: input.task, format: input.output.id, categoryId: null }

			const { result } = await route(request, options, async (engine, runOptions) =>
				engine.suggest(redacted, runOptions),
			)

			return result
		},
		explain: async (input, options) => {
			const redacted = redactPrivate(input)

			return toCard(
				await route(cardRequest(input, options), options, async (engine, runOptions) =>
					engine.explain(redacted, runOptions),
				),
			)
		},
		research: async (input, options) => {
			const redacted = redactPrivate(input)

			return toCard(
				await route(cardRequest(input, options), options, async (engine, runOptions) =>
					engine.research(redacted, runOptions),
				),
			)
		},
	}
}
