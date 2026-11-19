// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

/*
 * The OpenAI-compatible engine (docs/engines.md): any endpoint that speaks the chat completions API,
 * hosted or local. It writes from text only and cannot search, so it is told to leave sources empty.
 * The base URL, key and models are read from settings at every call, so switching provider is a
 * settings change and nothing else.
 */
import * as v from 'valibot'

import type { Db } from '#/server/db/client'

import {
	EngineError,
	parseJsonText,
	parseOutput,
	type Engine,
	type EngineInput,
	type OutputFormat,
	type Redacted,
	type RunOptions,
	type Tier,
} from './contract'
import { strictSchema } from './openai-strict-schema'
import { buildPrompt } from './prompt'
import { abortReason, oneAtATime, recordRun, type RunReport } from './runs'
import type { EngineId, EngineSettings } from './settings'

const engineId = 'openai-compatible' satisfies EngineId

// A 429 that names no reset time is assumed to last this long.
const defaultResetMs = 60_000

// How much of an unexpected response body an ordinary error carries.
const bodyTail = 500

const unitMs = new Map([
	['h', 3_600_000],
	['m', 60_000],
	['s', 1000],
	['ms', 1],
])

/** Seconds ("20") or a duration as some providers write it ("1m30s", "250ms"), in milliseconds. */
function durationMs(value: string): number | null {
	const parts = [...value.matchAll(/(?<amount>\d+(?:\.\d+)?)(?<unit>ms|h|m|s)?/gu)]
	const isWhole = parts.map(([part]) => part).join('') === value

	if (parts.length === 0 || !isWhole) {
		return null
	}

	return parts.reduce((total, { groups }) => {
		const unit = unitMs.get(groups?.unit ?? 's') ?? 1000

		return total + Number(groups?.amount) * unit
	}, 0)
}

function retryAfter(value: string, now: number): number | null {
	const delay = durationMs(value)
	const date = Date.parse(value)

	if (delay !== null) {
		return now + delay
	}

	return Number.isNaN(date) ? null : date
}

/**
 * When a 429's limit resets: `retry-after` (seconds or an HTTP date) or the
 * `x-ratelimit-reset-requests` and `x-ratelimit-reset-tokens` durations, whichever is latest.
 */
function resetTime(headers: Headers): Date {
	const now = Date.now()
	const after = headers.get('retry-after')

	const durations = ['x-ratelimit-reset-requests', 'x-ratelimit-reset-tokens'].map((name) =>
		durationMs(headers.get(name) ?? ''),
	)

	const times = [
		after === null ? null : retryAfter(after, now),
		...durations.map((duration) => (duration === null ? null : now + duration)),
	].filter((time) => time !== null)

	return new Date(times.length === 0 ? now + defaultResetMs : Math.max(...times))
}

interface Reply {
	readonly status: number
	readonly headers: Headers
	readonly text: string
}

/** Posts and reads the reply within the timeout; a stopped request fails with the reason it stopped. */
async function post(
	url: URL,
	init: RequestInit,
	{ timeoutMs, signal }: RunOptions,
): Promise<Reply> {
	signal?.throwIfAborted()

	const controller = new AbortController()
	const message = `The OpenAI-compatible endpoint did not answer within ${timeoutMs} ms`
	const timeout = new EngineError({ kind: 'timeout', afterMs: timeoutMs }, message)

	const timer = setTimeout(() => {
		controller.abort(timeout)
	}, timeoutMs)

	function onAbort() {
		if (signal !== undefined) {
			controller.abort(abortReason(signal))
		}
	}

	signal?.addEventListener('abort', onAbort, { once: true })

	try {
		const response = await fetch(url, { ...init, signal: controller.signal })

		return { status: response.status, headers: response.headers, text: await response.text() }
	} catch (error) {
		throw controller.signal.aborted ? abortReason(controller.signal) : error
	} finally {
		clearTimeout(timer)
		signal?.removeEventListener('abort', onAbort)
	}
}

function failureFrom({ status, headers, text }: Reply): Error {
	if (status === 429) {
		const resetsAt = resetTime(headers)

		return new EngineError({ kind: 'rate_limited', resetsAt }, 'The endpoint is rate limited')
	}

	if (status === 401 || status === 403) {
		return new EngineError({ kind: 'auth' }, `The endpoint answered ${status}`)
	}

	return new Error(`The OpenAI-compatible endpoint answered ${status}: ${text.slice(0, bodyTail)}`)
}

const integer = v.pipe(v.number(), v.integer())

const count = v.fallback(v.nullable(integer), null)

const textOrNull = v.fallback(v.nullable(v.string()), null)

const usageSchema = v.object({ prompt_tokens: count, completion_tokens: count })

const messageSchema = v.object({
	content: v.nullable(v.string()),
	refusal: textOrNull,
})

const choicesSchema = v.pipe(v.array(v.object({ message: messageSchema })), v.minLength(1))

const completionSchema = v.object({
	model: textOrNull,
	choices: choicesSchema,
	usage: v.fallback(usageSchema, { prompt_tokens: null, completion_tokens: null }),
})

function invalid(issue: string) {
	return new EngineError({ kind: 'invalid', issues: [issue] }, issue)
}

function readCompletion<TSchema extends v.GenericSchema>(
	output: OutputFormat<TSchema>,
	text: string,
	report: RunReport,
): v.InferOutput<TSchema> {
	const completion = v.safeParse(completionSchema, parseJsonText(text))

	if (!completion.success) {
		throw invalid('The response is not a chat completion')
	}

	const { model, choices, usage } = completion.output
	const [{ message }] = choices

	report.model = model ?? report.model
	report.inputTokens = usage.prompt_tokens
	report.outputTokens = usage.completion_tokens

	if (message.content === null) {
		throw invalid(`The model refused: ${message.refusal ?? 'no reason given'}`)
	}

	return parseOutput(output, parseJsonText(message.content))
}

type Settings = EngineSettings['openai-compatible']

interface Endpoint {
	readonly url: URL
	readonly apiKey: string | null
	readonly model: string
}

function endpointFor({ baseUrl, apiKey, models }: Settings, tier: Tier): Endpoint {
	const model = models[tier]

	if (baseUrl === null) {
		throw new Error('The OpenAI-compatible engine has no base URL')
	}

	if (model === null) {
		throw new Error(`The OpenAI-compatible engine has no model for the ${tier} tier`)
	}

	const base = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`

	return { url: new URL('chat/completions', base), apiKey, model }
}

function requestFor(input: Redacted<EngineInput>, { apiKey, model }: Endpoint): RequestInit {
	const { id, jsonSchema } = input.output
	const content = buildPrompt(input, { canSearch: false })
	const schema = strictSchema(jsonSchema)

	const body = {
		model,
		messages: [{ role: 'user', content }],
		response_format: { type: 'json_schema', json_schema: { name: id, strict: true, schema } },
	}

	const headers = new Headers({ 'content-type': 'application/json' })

	// A local model may take no key.
	if (apiKey !== null) {
		headers.set('authorization', `Bearer ${apiKey}`)
	}

	return { method: 'POST', headers, body: JSON.stringify(body) }
}

export interface OpenAiCompatibleOptions {
	readonly db: Db
	/** The engine's settings, read at every call so that a change applies to the next one. */
	readonly settings: () => Settings
}

/** The OpenAI-compatible engine: one request at a time, to the endpoint the settings name. */
export function createOpenAiCompatibleEngine({ db, settings }: OpenAiCompatibleOptions): Engine {
	const inTurn = oneAtATime()

	async function run<TSchema extends v.GenericSchema>(
		input: Redacted<EngineInput & { readonly output: OutputFormat<TSchema> }>,
		options: RunOptions,
	) {
		return inTurn(options.signal, async () => {
			const endpoint = endpointFor(settings(), options.tier)
			const { model } = endpoint
			const record = { db, engine: engineId, task: input.task, jobId: options.jobId ?? null, model }

			return recordRun(record, async (report) => {
				const reply = await post(endpoint.url, requestFor(input, endpoint), options)

				if (reply.status < 200 || reply.status > 299) {
					throw failureFrom(reply)
				}

				return readCompletion(input.output, reply.text, report)
			})
		})
	}

	return { id: engineId, suggest: run, explain: run, research: run }
}
