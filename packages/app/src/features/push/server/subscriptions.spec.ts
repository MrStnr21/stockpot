// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { afterEach, beforeEach, describe, expect, it, setSystemTime } from 'bun:test'
import {
	changedSubscription,
	subscriptionFactory,
	type SubscriptionChange,
} from '#tests/factories/push'
import { createTestDb, type TestDb } from '#tests/setup/db'
import { asc } from 'drizzle-orm'
import * as v from 'valibot'

import { pushSubscriptions } from '#/server/db/schema/push'

import {
	checkSubscriptionKey,
	maxSubscriptions,
	removalSchema,
	removeSubscription,
	saveSubscription,
	subscriptionSchema,
} from './subscriptions'

function toBase64Url(bytes: Uint8Array) {
	return bytes.toBase64({ alphabet: 'base64url', omitPadding: true })
}

function rows(db: TestDb) {
	return db.select().from(pushSubscriptions).orderBy(asc(pushSubscriptions.id)).all()
}

// 65 bytes like an uncompressed point, but with another first byte.
const compressedPrefix = toBase64Url(Uint8Array.of(0x02, ...new Uint8Array(64)))

describe('push subscriptions', () => {
	describe('subscriptionSchema', () => {
		it('accepts what a browser sends', () => {
			const subscription = subscriptionFactory.build({ expirationTime: 1_800_000_000_000 })

			expect(v.parse(subscriptionSchema, subscription)).toEqual(subscription)
		})

		it('accepts padded keys', () => {
			const { keys } = subscriptionFactory.build()

			const padded = subscriptionFactory.build({
				keys: { p256dh: `${keys.p256dh}=`, auth: `${keys.auth}==` },
			})

			expect(v.is(subscriptionSchema, padded)).toBe(true)
		})

		it.each<[string, SubscriptionChange]>([
			['a disallowed endpoint', { endpoint: 'https://stockpot.example.ts.net/push' }],
			['a missing expiration time', { expirationTime: undefined }],
			['a fractional expiration time', { expirationTime: 1.5 }],
			['a p256dh of 64 bytes', { keys: { p256dh: toBase64Url(new Uint8Array(64).fill(4)) } }],
			['a p256dh of 66 bytes', { keys: { p256dh: toBase64Url(new Uint8Array(66).fill(4)) } }],
			['a p256dh that is not an uncompressed point', { keys: { p256dh: compressedPrefix } }],
			['an auth of 15 bytes', { keys: { auth: toBase64Url(new Uint8Array(15)) } }],
			['an auth of 17 bytes', { keys: { auth: toBase64Url(new Uint8Array(17)) } }],
			['an auth that is not base64url', { keys: { auth: '!'.repeat(22) } }],
			['an auth in standard base64', { keys: { auth: '+/+/+/+/+/+/+/+/+/+/+w' } }],
		])('refuses %s', (_case, change) => {
			expect(v.is(subscriptionSchema, changedSubscription(change))).toBe(false)
		})

		it('never repeats the value it refuses', () => {
			const subscription = subscriptionFactory.build()

			const body = {
				endpoint: subscription.endpoint.replace('https:', 'http:'),
				expirationTime: 'soon',
				keys: { p256dh: subscription.keys.p256dh.slice(1), auth: subscription.keys.auth.slice(1) },
			}

			const messages = JSON.stringify(
				v.safeParse(subscriptionSchema, body).issues?.map((issue) => issue.message),
			)

			expect(
				[body.endpoint, body.keys.p256dh, body.keys.auth, 'soon'].filter((value) =>
					messages.includes(value),
				),
			).toEqual([])
		})
	})

	describe('checkSubscriptionKey', () => {
		it("accepts a browser's P-256 key", async () => {
			const checked = checkSubscriptionKey(subscriptionFactory.build())

			expect(await checked.then(() => 'accepted')).toBe('accepted')
		})

		it.each([
			['all zeros', new Uint8Array(64)],
			['x equal to y', new Uint8Array(64).fill(1)],
		])('refuses a point off the curve (%s) that passes the schema', async (_case, coordinates) => {
			const p256dh = toBase64Url(Uint8Array.of(0x04, ...coordinates))
			const subscription = subscriptionFactory.build({ keys: { p256dh } })

			expect(v.is(subscriptionSchema, subscription)).toBe(true)
			const checked = checkSubscriptionKey(subscription)

			expect(
				await checked.then(
					() => 'accepted',
					() => 'refused',
				),
			).toBe('refused')
		})
	})

	describe('removalSchema', () => {
		it('takes any endpoint up to 2048 characters, so a stored one can always be removed', () => {
			expect([
				v.is(removalSchema, { endpoint: 'https://stockpot.example.ts.net/push' }),
				v.is(removalSchema, { endpoint: 'a'.repeat(2049) }),
			]).toEqual([true, false])
		})
	})

	describe('saveSubscription', () => {
		let db: TestDb

		beforeEach(async () => {
			;({ db } = await createTestDb())
		})

		afterEach(() => {
			setSystemTime()
		})

		it('stores the subscription with its locale and expiry', () => {
			const subscription = subscriptionFactory.build({ expirationTime: 1_800_000_000_000 })

			saveSubscription(db, subscription, 'ru')

			expect(rows(db)).toMatchObject([
				{
					endpoint: subscription.endpoint,
					p256dh: subscription.keys.p256dh,
					auth: subscription.keys.auth,
					expiresAt: new Date(1_800_000_000_000),
					locale: 'ru',
				},
			])
		})

		it('updates the row with the same endpoint instead of adding one', () => {
			const first = subscriptionFactory.build({ expirationTime: 1_800_000_000_000 })
			const renewed = subscriptionFactory.build({ endpoint: first.endpoint })

			saveSubscription(db, first, 'en')
			const [{ id } = { id: 0 }] = rows(db)
			saveSubscription(db, renewed, 'ru')

			expect(rows(db)).toMatchObject([
				{
					id,
					endpoint: first.endpoint,
					p256dh: renewed.keys.p256dh,
					auth: renewed.keys.auth,
					expiresAt: null,
					locale: 'ru',
				},
			])
		})

		describe(`past ${maxSubscriptions} browsers`, () => {
			let endpoints: string[]

			beforeEach(() => {
				endpoints = Array.from({ length: maxSubscriptions + 1 }, (_, minute) => {
					setSystemTime(new Date(Date.UTC(2026, 10, 27, 9, minute)))

					const subscription = subscriptionFactory.build()

					saveSubscription(db, subscription, 'en')

					return subscription.endpoint
				})
			})

			it('drops the oldest to keep the newest ten', () => {
				expect(rows(db).map(({ endpoint }) => endpoint)).toEqual(endpoints.slice(1))
			})

			it('keeps ten when a stored browser subscribes again', () => {
				saveSubscription(db, subscriptionFactory.build({ endpoint: endpoints[1] }), 'en')

				expect(rows(db).map(({ endpoint }) => endpoint)).toEqual(endpoints.slice(1))
			})
		})
	})

	describe('removeSubscription', () => {
		let db: TestDb
		let kept: string

		beforeEach(async () => {
			;({ db } = await createTestDb())

			const [removed, other] = subscriptionFactory.buildList(2)

			saveSubscription(db, removed, 'en')
			saveSubscription(db, other, 'en')
			kept = other.endpoint
			removeSubscription(db, removed.endpoint)
		})

		it('removes only the row with that endpoint', () => {
			expect(rows(db).map(({ endpoint }) => endpoint)).toEqual([kept])
		})

		it('does nothing for an unknown endpoint', () => {
			removeSubscription(db, subscriptionFactory.build().endpoint)

			expect(rows(db)).toHaveLength(1)
		})
	})
})
