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

/**
 * `PushSubscription.toJSON()` as a browser sends it. The keys have the right lengths but are random
 * bytes, not a real P-256 point: enough for validation, not for encryption.
 */
export const subscriptionFactory = Factory.define<Subscription>(({ sequence }) => ({
	endpoint: faker.helpers.arrayElement(endpoints)(`${sequence}${faker.string.alphanumeric(40)}`),
	expirationTime: null,
	keys: {
		p256dh: toBase64Url(Uint8Array.of(0x04, ...randomBytes(64))),
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
