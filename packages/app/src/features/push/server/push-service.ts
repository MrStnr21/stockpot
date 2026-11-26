// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

/*
 * What the sender exchanges with a push service besides the message: the signed VAPID header it
 * sends (RFC 8292) and the error reason it may read back. Neither the header nor the keys behind it
 * leave this module and the sender.
 */
import { vapidHeaders, type PushSubscription } from '@block65/webcrypto-web-push'
import * as v from 'valibot'

import type { VapidKeys } from './vapid'

/* Apple asks for a new token at most once an hour and refuses one older than an hour; the library
 * sets `exp` twelve hours out, so an hour-old header is still valid everywhere. */
const headerLifetimeMs = 60 * 60 * 1000

// A push service's error body is a short JSON object; anything longer is not read.
const maxErrorBody = 1024

// Apple's `reason` is a word such as `BadJwtToken`; anything else is not written to the log.
const errorBodySchema = v.object({ reason: v.pipe(v.string(), v.regex(/^[A-Za-z]{1,40}$/u)) })

/** The body as text if it is at most 1 KiB; a longer one is cancelled unread. */
async function readSmallBody(response: Response): Promise<string | null> {
	const reader = response.body?.getReader()

	if (reader === undefined) {
		return null
	}

	const chunks: Uint8Array<ArrayBuffer>[] = []

	let size = 0

	try {
		// oxlint-disable-next-line eslint/no-await-in-loop -- A stream yields its chunks one after another.
		for (let read = await reader.read(); !read.done; read = await reader.read()) {
			chunks.push(read.value)
			size += read.value.byteLength

			if (size > maxErrorBody) {
				return null
			}
		}
	} finally {
		await reader.cancel().catch(() => null)
	}

	return new Blob(chunks).text()
}

/** The `reason` of a push service's JSON error body, when it is a plain word. */
export async function readErrorReason(response: Response): Promise<string | null> {
	try {
		const text = await readSmallBody(response)
		const parsed = v.safeParse(errorBodySchema, text === null ? null : JSON.parse(text))

		return parsed.success ? parsed.output.reason : null
	} catch {
		return null
	}
}

/**
 * Signs the VAPID header for each push service's origin, the JWT's audience (RFC 8292 §2), and keeps
 * it for an hour. The promise is kept, so browsers on one push service share one signature even when
 * they are sent to at the same time; a failed signature is dropped so the next send tries again.
 */
export function createVapidHeaderCache(subject: string, now: () => Date) {
	const headers = new Map<string, { authorization: Promise<string>; signedAt: number }>()

	return async (subscription: PushSubscription, keys: VapidKeys): Promise<string> => {
		const audience = new URL(subscription.endpoint).origin
		const at = now().getTime()
		const cached = headers.get(audience)

		if (cached !== undefined && at - cached.signedAt < headerLifetimeMs) {
			return cached.authorization
		}

		const authorization = vapidHeaders(subscription, { subject, ...keys }).then(
			(signed) => signed.headers.authorization,
		)

		headers.set(audience, { authorization, signedAt: at })

		authorization.catch(() => {
			if (headers.get(audience)?.authorization === authorization) {
				headers.delete(audience)
			}
		})

		return authorization
	}
}
