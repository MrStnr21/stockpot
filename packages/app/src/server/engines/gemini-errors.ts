// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

/*
 * How the Gemini engine reads a failed request (docs/engines.md, "The Gemini engine"), apart from the
 * engine so that it stays a pure function with its own spec. Only `gemini.ts` uses it.
 */
import * as v from 'valibot'

import { EngineError } from './contract'
import { nextPacificMidnight } from './gemini-usage'

// A 429 that names neither a retry delay nor a daily quota is assumed to last this long.
const defaultResetMs = 60_000

// How much of an unexpected error message an ordinary error carries.
const messageTail = 500

/** What the SDK's `ApiError` carries: the status, and the provider's JSON error body as its message. */
export interface GeminiApiError {
	readonly status: number
	readonly message: string
}

const delay = v.pipe(v.string(), v.regex(/^\d+(?:\.\d+)?s$/u))

const violationSchema = v.object({ quotaId: v.string() })

/* The fields of the three `google.rpc` details stockpot reads: `RetryInfo`, `QuotaFailure` and
 * `ErrorInfo`. Any other detail reads as an empty one. */
const violationsSchema = v.array(violationSchema)

const reasonSchema = v.string()

const detailSchema = v.object({
	retryDelay: v.fallback(v.nullable(delay), null),
	violations: v.fallback(v.nullable(violationsSchema), null),
	reason: v.fallback(v.nullable(reasonSchema), null),
})

type Detail = v.InferOutput<typeof detailSchema>

const noDetail = { retryDelay: null, violations: null, reason: null }

const detailsSchema = v.array(v.fallback(detailSchema, noDetail))

const errorSchema = v.object({ details: v.fallback(detailsSchema, []) })

const errorBodySchema = v.object({ error: errorSchema })

function errorDetails({ message }: GeminiApiError): Detail[] {
	try {
		const body = v.safeParse(errorBodySchema, JSON.parse(message))

		return body.success ? body.output.error.details : []
	} catch {
		return []
	}
}

function isDailyQuota({ violations }: Detail) {
	return (violations ?? []).some(({ quotaId }) => quotaId.includes('PerDay'))
}

/**
 * When a 429's limit resets: the later of the `RetryInfo` delay and the next Pacific midnight for a
 * daily quota, or a minute from now when the error names neither. A daily quota often comes with a
 * short `RetryInfo`; reading only that would retry every minute until midnight.
 */
function resetTime(details: readonly Detail[]): Date {
	const now = Date.now()
	const retryDelay = details.find((detail) => detail.retryDelay !== null)?.retryDelay ?? null
	const isDaily = details.some((detail) => isDailyQuota(detail))

	const times = [
		retryDelay === null ? null : now + Number(retryDelay.slice(0, -1)) * 1000,
		isDaily ? nextPacificMidnight(now).getTime() : null,
	].filter((time) => time !== null)

	return new Date(times.length === 0 ? now + defaultResetMs : Math.max(...times))
}

// Gemini answers a bad key with 400 and the `API_KEY_INVALID` reason, not with 401.
function isKeyRejected({ reason }: Detail) {
	return reason === 'API_KEY_INVALID'
}

/**
 * The error a failed request becomes: 429 is `rate_limited`, a rejected key `auth`, and anything else
 * an ordinary error whose message is stripped of the key and cut.
 */
export function geminiFailure(error: GeminiApiError, apiKey: string): Error {
	const details = errorDetails(error)

	if (error.status === 429) {
		const resetsAt = resetTime(details)

		return new EngineError({ kind: 'rate_limited', resetsAt }, 'Gemini is rate limited')
	}

	if (
		error.status === 401 ||
		error.status === 403 ||
		details.some((detail) => isKeyRejected(detail))
	) {
		return new EngineError({ kind: 'auth' }, `Gemini answered ${error.status}`)
	}

	const message = error.message.replaceAll(apiKey, '[key]').slice(0, messageTail)

	return new Error(`Gemini answered ${error.status}: ${message}`)
}
