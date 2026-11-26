// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

/*
 * Sends one notification to every subscribed browser (RFC 8030), encrypted for each (RFC 8291) and
 * signed with the instance's VAPID key (RFC 8292). A notification is best effort: the card is already
 * in the app, so a failure is logged and never retried, and `send` never throws for one browser. The
 * log names a subscription by its id and its push service's host only: an endpoint is a capability
 * to notify that browser, and the keys and the JWT are secrets.
 */
import { encryptNotification, type PushSubscription } from '@block65/webcrypto-web-push'
import { eq } from 'drizzle-orm'

import { pushPayload } from '#/features/push/shared/payload'
import type { Locale } from '#/lib/i18n'
import type { Db } from '#/server/db/client'
import { pushSubscriptions } from '#/server/db/schema/push'
import { log } from '#/server/log'

import { isAllowedEndpoint } from './endpoints'
import type { PushMessage } from './messages'
import { createVapidHeaderCache, readErrorReason } from './push-service'
import { vapidKeys } from './vapid'

/** The part of `fetch` the sender uses; specs pass their own. */
export type PushFetch = (url: string, init: RequestInit) => Promise<Response>

export interface PushSenderOptions {
	readonly db: Db
	/** The VAPID `sub` claim: an https URL or a `mailto:` a push service can reach the sender at. */
	readonly subject: string
	/** The instance's public origin, which a tap on the notification opens. */
	readonly origin: string
	readonly fetch?: PushFetch
	readonly now?: () => Date
}

/** How many browsers got the notification, how many subscriptions were deleted, and how many failed. */
export interface SendResult {
	readonly sent: number
	readonly removed: number
	readonly failed: number
}

export interface PushSender {
	/** Sends the message `build` writes for each subscription's locale; `null` sends nothing. */
	send: (build: (locale: Locale) => PushMessage | null) => Promise<SendResult>
}

type Outcome = keyof SendResult | 'skipped'

type SubscriptionRow = typeof pushSubscriptions.$inferSelect

/** What one send shares across its subscriptions. */
interface Delivery {
	readonly db: Db
	readonly origin: string
	readonly post: PushFetch
	readonly now: () => Date
	readonly authorize: (subscription: PushSubscription) => Promise<string>
	readonly messageFor: (locale: Locale) => PushMessage | null
}

const requestTimeoutMs = 10_000

function hostOf(endpoint: string): string {
	return URL.parse(endpoint)?.hostname ?? 'invalid'
}

function localeOf(value: string): Locale {
	return value === 'ru' ? 'ru' : 'en'
}

/* The keys as unpadded base64url: the route accepts padded ones, which the library's decoder would
 * pad again and fail on. */
function unpadded(value: string): string {
	return Uint8Array.fromBase64(value, { alphabet: 'base64url' }).toBase64({
		alphabet: 'base64url',
		omitPadding: true,
	})
}

function removeRow(
	db: Db,
	row: SubscriptionRow,
	{ message, status }: { message: string; status?: number },
) {
	db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, row.id)).run()

	log.info(message, {
		subscription: row.id,
		host: hostOf(row.endpoint),
		...(status !== undefined && { status }),
	})
}

async function settle(
	delivery: Delivery,
	row: SubscriptionRow,
	response: Response,
): Promise<Outcome> {
	if (response.ok) {
		await response.body?.cancel().catch(() => null)

		return 'sent'
	}

	// RFC 8030 §7.3: the subscription is gone (404), or has expired (410, as Apple says it).
	if (response.status === 404 || response.status === 410) {
		await response.body?.cancel().catch(() => null)

		removeRow(delivery.db, row, {
			message: 'Removed a push subscription its push service no longer knows',
			status: response.status,
		})

		return 'removed'
	}

	const reason = await readErrorReason(response)

	log.warn('A push service refused a notification', {
		subscription: row.id,
		host: hostOf(row.endpoint),
		status: response.status,
		...(reason !== null && { reason }),
	})

	return 'failed'
}

async function deliver(
	delivery: Delivery,
	row: SubscriptionRow,
	message: PushMessage,
): Promise<Outcome> {
	const subscription: PushSubscription = {
		endpoint: row.endpoint,
		expirationTime: null,
		keys: { p256dh: unpadded(row.p256dh), auth: unpadded(row.auth) },
	}

	const payload = pushPayload(message, { origin: delivery.origin, lang: localeOf(row.locale) })

	const body = await encryptNotification(
		subscription,
		new TextEncoder().encode(JSON.stringify(payload)),
	)

	const response = await delivery.post(row.endpoint, {
		method: 'POST',
		redirect: 'error',
		signal: AbortSignal.timeout(requestTimeoutMs),
		headers: {
			authorization: await delivery.authorize(subscription),
			ttl: String(message.ttl),
			urgency: message.urgency,
			...(message.topic !== undefined && { topic: message.topic }),
			'content-encoding': 'aes128gcm',
			'content-type': 'application/octet-stream',
		},
		body,
	})

	return settle(delivery, row, response)
}

async function attempt(delivery: Delivery, row: SubscriptionRow): Promise<Outcome> {
	if (row.expiresAt !== null && row.expiresAt.getTime() <= delivery.now().getTime()) {
		removeRow(delivery.db, row, { message: 'Removed an expired push subscription' })

		return 'removed'
	}

	// Checked again here, so a row that reached the table some other way gets no request.
	if (!isAllowedEndpoint(row.endpoint)) {
		removeRow(delivery.db, row, {
			message: 'Removed a push subscription outside the known push services',
		})

		return 'removed'
	}

	try {
		const message = delivery.messageFor(localeOf(row.locale))

		return message === null ? 'skipped' : await deliver(delivery, row, message)
	} catch (error) {
		/* Only the error's name: a fetch error's message can carry the endpoint, and the library's
		 * describe the keys. A timeout is a `TimeoutError`, a refused redirect a `TypeError`. */
		log.warn('Could not send a notification', {
			subscription: row.id,
			host: hostOf(row.endpoint),
			error: error instanceof Error ? error.name : 'unknown',
		})

		return 'failed'
	}
}

/** A sender for one instance; it keeps each push service's signed header for an hour. */
export function createPushSender({
	db,
	subject,
	origin,
	fetch: post = async (url, init) => fetch(url, init),
	now = () => new Date(),
}: PushSenderOptions): PushSender {
	const sign = createVapidHeaderCache(subject, now)

	return {
		async send(build) {
			const rows = db.select().from(pushSubscriptions).all()
			const result = { sent: 0, removed: 0, failed: 0 }

			if (rows.length === 0) {
				return result
			}

			const keys = await vapidKeys(db)
			const messages = new Map<Locale, PushMessage | null>()

			const delivery: Delivery = {
				db,
				origin,
				post,
				now,
				authorize: async (subscription) => sign(subscription, keys),
				messageFor(locale) {
					if (!messages.has(locale)) {
						messages.set(locale, build(locale))
					}

					return messages.get(locale) ?? null
				},
			}

			// At most ten subscriptions (the cap), so all go at once.
			const outcomes = await Promise.allSettled(rows.map(async (row) => attempt(delivery, row)))

			for (const outcome of outcomes) {
				const kind = outcome.status === 'fulfilled' ? outcome.value : 'failed'

				if (kind !== 'skipped') {
					result[kind] += 1
				}
			}

			return result
		},
	}
}
