// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

/*
 * The Gemini engine (docs/engines.md, "The Gemini engine"), through Google's `@google/genai` SDK, which
 * no other module imports. A suggestion is one structured call without search. A card is two calls:
 * facts from Google Search and the note's link, then the card as structured output from those facts,
 * because Gemini 2.5 rejects structured output together with tools and the owner's free tier allows
 * search only on Gemini 2.5 (observed in probes on 2026-11-19). An idea report is the loop in
 * `gemini-research.ts`. The key, the models and the limits are read from settings at every call.
 */
import { ApiError, GoogleGenAI, type GenerateContentConfig, type HttpOptions } from '@google/genai'
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
import { researchIdea, type Generate } from './gemini-research'
import { addUsage, answerText, readFacts, type Facts } from './gemini-response'
import { structured } from './gemini-schema'
import { suggestionThinking } from './gemini-thinking'
import {
	createUsageCounters,
	pastRequests,
	requestsPerCall,
	type UsageCounters,
} from './gemini-usage'
import { buildPrompt } from './prompt'
import { abortReason, oneAtATime, recordRun, type Line, type RunReport } from './runs'
import type { EngineId, EngineSettings } from './settings'

export { geminiSchema } from './gemini-schema'

const engineId = 'gemini' satisfies EngineId

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

type Settings = EngineSettings['gemini']

interface Request {
	readonly client: GoogleGenAI
	readonly model: string
	readonly apiKey: string
	readonly options: RunOptions
	/** Takes the engine's line for each request, instead of the caller for the whole call. */
	readonly line?: Line
}

/**
 * Runs `call` with a `generate` that stops at the timeout or the caller's abort, whichever comes
 * first, across every request the call makes; a stopped request fails with the reason it stopped.
 */
async function withDeadline<T>(
	{ client, model, apiKey, line, options: { timeoutMs, signal } }: Request,
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

	/* `step` is a signal of the caller's own, such as a research step's cap: it stops this request
	 * alone, and the call goes on. */
	async function generate(contents: string, config: GenerateContentConfig, step?: AbortSignal) {
		controller.signal.throwIfAborted()
		step?.throwIfAborted()

		const stop = step === undefined ? controller.signal : AbortSignal.any([controller.signal, step])

		const request = { model, contents, config: { ...config, abortSignal: stop } }

		async function send() {
			return client.models.generateContent(request)
		}

		try {
			return await (line === undefined ? send() : line(stop, send))
		} catch (error) {
			if (controller.signal.aborted) {
				throw abortReason(controller.signal)
			}

			if (step?.aborted === true) {
				throw abortReason(step)
			}

			if (error instanceof ApiError) {
				throw geminiFailure(error, apiKey)
			}

			// A network error may quote the request, key included; the job keeps its message.
			if (error instanceof Error && error.message.includes(apiKey)) {
				// oxlint-disable-next-line preserve-caught-error -- The cause quotes the key, which must not reach the job.
				throw new Error(error.message.replaceAll(apiKey, '[key]'))
			}

			throw error
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

/** What one call works with: the tier's model, its requests within the deadline, and its run. */
interface Call {
	readonly model: string
	readonly generate: Generate
	readonly report: RunReport
}

async function suggest<TSchema extends v.GenericSchema>(
	input: Redacted<EngineInput & { readonly output: OutputFormat<TSchema> }>,
	{ model, generate, report }: Call,
) {
	const prompt = buildPrompt(input, { canSearch: false })
	const thinkingConfig = suggestionThinking(model)
	const thinking = thinkingConfig === undefined ? {} : { thinkingConfig }
	const response = await generate(prompt, { ...structured(input.output), ...thinking })

	addUsage(report, response)

	return parseOutput(input.output, parseJsonText(answerText(response)))
}

async function writeCard<TSchema extends v.GenericSchema>(
	input: Redacted<CardInput & { readonly output: OutputFormat<TSchema> }>,
	{ generate, report }: Call,
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
	/** The process's usage counters; by default the engine starts its own from `engine_runs`. */
	readonly counters?: UsageCounters
	/** Replaces `fetch` for the SDK's requests: specs answer from recorded responses. */
	readonly fetch?: typeof fetch
}

/** The Gemini engine: one call at a time, within the configured limits of each tier's model. */
export function createGeminiEngine({
	db,
	settings,
	counters = createUsageCounters(pastRequests(db, engineId)),
	fetch,
}: GeminiOptions): Engine {
	const inTurn = oneAtATime()

	/* No `retryOptions`: the SDK retries only when given them, and retries are the job runner's,
	 * which knows the error kinds. Search needs v1beta: on v1, the SDK's default, Gemini refused it
	 * (observed 2026-11-19). */
	const httpOptions: HttpOptions = { apiVersion: 'v1beta' }

	if (fetch !== undefined) {
		httpOptions.fetch = fetch
	}

	async function run<TSchema extends v.GenericSchema>(
		input: Redacted<EngineInput & { readonly output: OutputFormat<TSchema> }>,
		options: RunOptions,
	) {
		const record = { db, engine: engineId, task: input.task, jobId: options.jobId ?? null }

		async function call() {
			return recordRun(record, async (report) => {
				const { apiKey, models, limits } = settings()
				const model = models[options.tier]

				report.model = model

				if (apiKey === null) {
					throw new Error('The Gemini engine has no key')
				}

				if (model === null) {
					throw new Error(`The Gemini engine has no model for the ${options.tier} tier`)
				}

				// A card takes two requests and a research call seven; all must fit before the first.
				counters.take(model, limits[options.tier], requestsPerCall(input.task))

				const client = new GoogleGenAI({ apiKey, httpOptions })
				const line = input.task === 'research' ? inTurn : undefined
				const request = { client, model, apiKey, options, line }

				return withDeadline(request, async (generate) => {
					const context = { model, generate, report }

					if (input.task === 'suggest') {
						return suggest(input, context)
					}

					if (input.task === 'research') {
						const { timeoutMs, onProgress } = options

						return researchIdea(input, { ...context, timeoutMs, onProgress })
					}

					return writeCard(input, context)
				})
			})
		}

		/* A research call takes the line per request, so that it holds back a suggestion for one
		 * request instead of fifteen minutes; everything else takes it for the whole call. */
		return input.task === 'research' ? call() : inTurn(options.signal, call)
	}

	return { id: engineId, suggest: run, explain: run, research: run }
}
