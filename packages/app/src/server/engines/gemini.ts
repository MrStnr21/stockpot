// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

/*
 * The Gemini engine (docs/engines.md, "The Gemini engine"), through Google's `@google/genai` SDK, which
 * no other module imports. A suggestion is one structured call without search. A card is two calls:
 * facts from Google Search and the note's link, then the card as structured output from those facts,
 * because Gemini 2.5 rejects structured output together with tools and the owner's free tier allows
 * search only on Gemini 2.5 (recorded 2026-11-19). The key, the models and the limits are read from
 * settings at every call.
 */
import {
	ApiError,
	GoogleGenAI,
	ThinkingLevel,
	type GenerateContentConfig,
	type GenerateContentResponse,
	type HttpOptions,
} from '@google/genai'
import type { JsonSchema } from '@valibot/to-json-schema'
import type * as v from 'valibot'

import type { Db } from '#/server/db/client'

import {
	EngineError,
	parseJsonText,
	parseOutput,
	type CardInput,
	type Engine,
	type EngineInput,
	type OutputFormat,
	type Redacted,
	type RunOptions,
} from './contract'
import { geminiFailure } from './gemini-errors'
import { addUsage, answerText, readFacts, type Facts } from './gemini-response'
import { createUsageCounters, type UsageCounters } from './gemini-usage'
import { buildPrompt } from './prompt'
import { abortReason, oneAtATime, recordRun, type RunReport } from './runs'
import type { EngineId, EngineSettings } from './settings'

const engineId = 'gemini' satisfies EngineId

/**
 * The derived JSON Schema as `responseJsonSchema` takes it. Real calls on 2026-11-19 showed that it
 * accepts draft-07 as derived, `pattern`, `format: uri`, `anyOf` and nullable types included, so only
 * `$schema`, which it does not use, is left out. `responseSchema` is not used: it rejects `$schema`
 * and `additionalProperties`.
 */
export function geminiSchema(schema: JsonSchema): JsonSchema {
	// oxlint-disable-next-line no-unused-vars -- The stripped keyword is named only to leave it out.
	const { $schema, ...rest } = schema

	return rest
}

const factsStep = [
	'# This step',
	"Do not write the card yet, and do not answer in JSON. Search, open the note's link if it has one, and write down the facts the card needs as short plain-text notes.",
].join('\n')

function cardPrompt(input: Redacted<CardInput>, { text, sources }: Facts) {
	const list = sources.map(({ title, uri }) => `- ${title}: ${uri}`)

	return [
		buildPrompt(input, { canSearch: true }),
		'# Research',
		'What a search for this note found. Write the card from it, and take sources only from the list below.',
		text,
		`Sources:\n${list.length === 0 ? '- none' : list.join('\n')}`,
	].join('\n\n')
}

function structured(output: OutputFormat): GenerateContentConfig {
	return {
		responseMimeType: 'application/json',
		responseJsonSchema: geminiSchema(output.jsonSchema),
	}
}

type Settings = EngineSettings['gemini']

type Generate = (
	contents: string,
	config: GenerateContentConfig,
) => Promise<GenerateContentResponse>

interface Request {
	readonly client: GoogleGenAI
	readonly model: string
	readonly apiKey: string
	readonly options: RunOptions
}

/**
 * Runs `call` with a `generate` that stops at the timeout or the caller's abort, whichever comes
 * first, across every request the call makes; a stopped request fails with the reason it stopped.
 */
async function withDeadline<T>(
	{ client, model, apiKey, options: { timeoutMs, signal } }: Request,
	call: (generate: Generate) => Promise<T>,
): Promise<T> {
	signal?.throwIfAborted()

	const controller = new AbortController()
	const message = `Gemini did not answer within ${timeoutMs} ms`
	const timeout = new EngineError({ kind: 'timeout', afterMs: timeoutMs }, message)

	const timer = setTimeout(() => {
		controller.abort(timeout)
	}, timeoutMs)

	function onAbort() {
		if (signal !== undefined) {
			controller.abort(abortReason(signal))
		}
	}

	async function generate(contents: string, config: GenerateContentConfig) {
		controller.signal.throwIfAborted()

		try {
			const request = { model, contents, config: { ...config, abortSignal: controller.signal } }

			return await client.models.generateContent(request)
		} catch (error) {
			if (controller.signal.aborted) {
				throw abortReason(controller.signal)
			}

			throw error instanceof ApiError ? geminiFailure(error, apiKey) : error
		}
	}

	signal?.addEventListener('abort', onAbort, { once: true })

	try {
		return await call(generate)
	} finally {
		clearTimeout(timer)
		signal?.removeEventListener('abort', onAbort)
	}
}

async function suggest<TSchema extends v.GenericSchema>(
	input: Redacted<EngineInput & { readonly output: OutputFormat<TSchema> }>,
	generate: Generate,
	report: RunReport,
) {
	const prompt = buildPrompt(input, { canSearch: false })
	const thinkingConfig = { thinkingLevel: ThinkingLevel.MINIMAL }
	const response = await generate(prompt, { ...structured(input.output), thinkingConfig })

	addUsage(report, response)

	return parseOutput(input.output, parseJsonText(answerText(response)))
}

async function writeCard<TSchema extends v.GenericSchema>(
	input: Redacted<CardInput & { readonly output: OutputFormat<TSchema> }>,
	generate: Generate,
	report: RunReport,
) {
	const factsPrompt = `${buildPrompt(input, { canSearch: true })}\n\n${factsStep}`
	const tools = [{ googleSearch: {} }, { urlContext: {} }]
	const grounded = await generate(factsPrompt, { tools })

	addUsage(report, grounded)

	const facts = readFacts(grounded, report)
	const response = await generate(cardPrompt(input, facts), structured(input.output))

	addUsage(report, response)

	return parseOutput(input.output, parseJsonText(answerText(response)))
}

export interface GeminiOptions {
	readonly db: Db
	/** The engine's settings, read at every call so that a change applies to the next one. */
	readonly settings: () => Settings
	/** The process's usage counters; a new engine starts its own. */
	readonly counters?: UsageCounters
	/** Replaces `fetch` for the SDK's requests: specs answer from recorded responses. */
	readonly fetch?: typeof fetch
}

/** The Gemini engine: one call at a time, within the configured limits of each tier's model. */
export function createGeminiEngine({
	db,
	settings,
	counters = createUsageCounters(),
	fetch,
}: GeminiOptions): Engine {
	const inTurn = oneAtATime()

	/* Retries are the job runner's, which knows the error kinds; the SDK would retry a 429 itself.
	 * Search needs v1beta: on v1, the SDK's default, Gemini refuses it (recorded 2026-11-19). */
	const httpOptions: HttpOptions = { apiVersion: 'v1beta', retryOptions: { attempts: 1 } }

	if (fetch !== undefined) {
		httpOptions.fetch = fetch
	}

	async function run<TSchema extends v.GenericSchema>(
		input: Redacted<EngineInput & { readonly output: OutputFormat<TSchema> }>,
		options: RunOptions,
	) {
		const record = { db, engine: engineId, task: input.task, jobId: options.jobId ?? null }

		return inTurn(options.signal, async () =>
			recordRun(record, async (report) => {
				const { apiKey, models, limits } = settings()
				const model = models[options.tier]

				report.model = model

				if (apiKey === null) {
					throw new Error('The Gemini engine has no key')
				}

				if (model === null) {
					throw new Error(`The Gemini engine has no model for the ${options.tier} tier`)
				}

				// A card takes two requests, and both must fit before the first is sent.
				counters.take(model, limits[options.tier], input.task === 'suggest' ? 1 : 2)

				const client = new GoogleGenAI({ apiKey, httpOptions })
				const request = { client, model, apiKey, options }

				return withDeadline(request, async (generate) =>
					input.task === 'suggest'
						? suggest(input, generate, report)
						: writeCard(input, generate, report),
				)
			}),
		)
	}

	return { id: engineId, suggest: run, explain: run, research: run }
}
