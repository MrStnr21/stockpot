// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

/*
 * The browsers that receive notifications. A browser has one subscription per service worker, so its
 * endpoint identifies the device: subscribing again replaces that row's keys rather than adding one.
 */
import { desc, eq, notInArray } from 'drizzle-orm'
import * as v from 'valibot'

import type { Locale } from '#/lib/i18n'
import type { Db } from '#/server/db/client'
import { pushSubscriptions } from '#/server/db/schema/push'
import { HttpError } from '#/server/http'

import { isAllowedEndpoint, maxEndpointLength } from './endpoints'

/* More than any one owner has browsers; the cap only bounds what a send fans out to, so the oldest
 * subscription, the one most likely to be stale, makes room for a new one. */
export const maxSubscriptions = 10

/* Every message is fixed text: a failing value is never echoed back, so an answer never repeats an
 * endpoint or a key. */
function base64UrlBytes(length: number, startsWith?: number) {
	const message = `Use the browser's key: ${length} bytes as base64url.`

	return v.pipe(
		v.string(message),
		// Room for padding, which the decoder accepts too.
		v.maxLength(Math.ceil(length / 3) * 4, message),
		v.check((value) => {
			try {
				const bytes = Uint8Array.fromBase64(value, { alphabet: 'base64url' })

				return bytes.length === length && (startsWith === undefined || bytes[0] === startsWith)
			} catch {
				return false
			}
		}, message),
	)
}

const endpointMessage = 'Use an endpoint of a known push service.'

const expiryMessage = 'Use a time in milliseconds or null.'

const expirySchema = v.nullable(v.pipe(v.number(expiryMessage), v.safeInteger(expiryMessage)))

/** `PushSubscription.toJSON()` from a browser. */
export const subscriptionSchema = v.object(
	{
		endpoint: v.pipe(v.string(endpointMessage), v.check(isAllowedEndpoint, endpointMessage)),
		expirationTime: expirySchema,
		keys: v.object(
			{
				// An uncompressed P-256 point (RFC 8291 §3.1) and a 16-byte secret (§3.2).
				p256dh: base64UrlBytes(65, 0x04),
				auth: base64UrlBytes(16),
			},
			'Send the subscription keys.',
		),
	},
	'Send the subscription as PushSubscription.toJSON() gives it.',
)

export type Subscription = v.InferOutput<typeof subscriptionSchema>

const curve = { name: 'ECDH', namedCurve: 'P-256' } as const

/**
 * Refuses a `p256dh` that is not a point on P-256 with a 400, as `readJson` refuses the rest. The
 * schema checks only its length and first byte; Web Crypto checks the curve, asynchronously. A key off
 * the curve would fail every send, and no push service would answer 404 or 410 to get it deleted.
 */
export async function checkSubscriptionKey({ keys }: Subscription): Promise<void> {
	try {
		const point = Uint8Array.fromBase64(keys.p256dh, { alphabet: 'base64url' })

		await crypto.subtle.importKey('raw', point, curve, true, [])
	} catch {
		throw new HttpError(400, {
			code: 'invalid_body',
			message: 'The body does not match what this route accepts.',
			issues: ["keys.p256dh: Use the browser's key: a P-256 point as base64url."],
		})
	}
}

export const removalSchema = v.object(
	{
		endpoint: v.pipe(v.string(endpointMessage), v.maxLength(maxEndpointLength, endpointMessage)),
	},
	'Send the endpoint to remove.',
)

/**
 * Stores a browser's subscription in its locale, or updates the row with the same endpoint, then drops
 * the oldest rows past the cap.
 */
export function saveSubscription(db: Db, subscription: Subscription, locale: Locale): void {
	const { endpoint, expirationTime, keys } = subscription

	const values = {
		p256dh: keys.p256dh,
		auth: keys.auth,
		expiresAt: expirationTime === null ? null : new Date(expirationTime),
		locale,
	}

	db.transaction((tx) => {
		tx.insert(pushSubscriptions)
			.values({ endpoint, ...values })
			.onConflictDoUpdate({ target: pushSubscriptions.endpoint, set: values })
			.run()

		const kept = tx
			.select({ id: pushSubscriptions.id })
			.from(pushSubscriptions)
			.orderBy(desc(pushSubscriptions.createdAt), desc(pushSubscriptions.id))
			.limit(maxSubscriptions)

		tx.delete(pushSubscriptions).where(notInArray(pushSubscriptions.id, kept)).run()
	})
}

/** Removes the subscription with this endpoint, if there is one. */
export function removeSubscription(db: Db, endpoint: string): void {
	db.delete(pushSubscriptions).where(eq(pushSubscriptions.endpoint, endpoint)).run()
}
