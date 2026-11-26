// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { faker } from '@faker-js/faker'
import { Factory } from 'fishery'

import type { Subscription } from '#/features/push/server/subscriptions'

function randomBytes(length: number) {
	return Uint8Array.from({ length }, () => faker.number.int({ max: 255 }))
}

function toBase64Url(bytes: Uint8Array) {
	return bytes.toBase64({ alphabet: 'base64url', omitPadding: true })
}

/* Endpoints on each push service the server accepts, with a random path, as browsers make them. */
const endpoints = [
	(id: string) => `https://fcm.googleapis.com/fcm/send/${id}`,
	(id: string) => `https://updates.push.services.mozilla.com/wpush/v2/${id}`,
	(id: string) => `https://web.push.apple.com/${id}`,
	(id: string) => `https://wns2-par02p.notify.windows.com/w/?token=${id}`,
]

async function curvePoint() {
	const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, [
		'deriveBits',
	])

	return toBase64Url(new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey)))
}

/* Web Crypto makes keys asynchronously and a factory builds synchronously, so a few real points are
 * made once; consecutive builds take different ones. */
const curvePoints = await Promise.all(Array.from({ length: 8 }, curvePoint))

/**
 * `PushSubscription.toJSON()` as a browser sends it. `p256dh` is a real P-256 point, as the route
 * accepts no other, but its private key is gone: enough to subscribe, not to read a push. A spec
 * that decrypts uses `pushClient()`.
 */
export const subscriptionFactory = Factory.define<Subscription>(({ sequence }) => ({
	endpoint: faker.helpers.arrayElement(endpoints)(`${sequence}${faker.string.alphanumeric(40)}`),
	expirationTime: null,
	keys: {
		p256dh: curvePoints[sequence % curvePoints.length] ?? '',
		auth: toBase64Url(randomBytes(16)),
	},
}))

/** Fields to replace in a built subscription, with values a client might send whether valid or not. */
export interface SubscriptionChange {
	endpoint?: string
	expirationTime?: number | null | undefined
	keys?: Partial<Subscription['keys']>
}

/** A built subscription with some fields replaced, the keys merged rather than replaced. */
export function changedSubscription(change: SubscriptionChange): SubscriptionChange {
	const built = subscriptionFactory.build()

	return { ...built, ...change, keys: { ...built.keys, ...change.keys } }
}
