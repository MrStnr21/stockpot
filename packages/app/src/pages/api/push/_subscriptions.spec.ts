// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test'
import {
	changedSubscription,
	subscriptionFactory,
	type SubscriptionChange,
} from '#tests/factories/push'
import {
	sendThroughMiddleware,
	signedInInstance,
	type RouteHandler,
	type SignedInInstance,
} from '#tests/setup/auth'
import { createTestDb, type TestDb } from '#tests/setup/db'
import { asc } from 'drizzle-orm'

import * as instance from '#/server/db/instance'
import { pushSubscriptions } from '#/server/db/schema/push'

import { DELETE, POST } from './subscriptions'

const publicOrigin = 'https://stockpot.example.ts.net'

const url = `${publicOrigin}/api/push/subscriptions`

type Sender = 'owner' | 'device' | 'nobody' | 'cookie without origin'

describe('/api/push/subscriptions', () => {
	let db: TestDb
	let signedIn: SignedInInstance

	beforeEach(async () => {
		;({ db } = await createTestDb())
		signedIn = signedInInstance(db, publicOrigin)
		spyOn(instance, 'instanceDb').mockResolvedValue(db)
	})

	afterEach(() => {
		mock.restore()
	})

	function rows() {
		return db.select().from(pushSubscriptions).orderBy(asc(pushSubscriptions.id)).all()
	}

	interface Sent {
		method: 'POST' | 'DELETE'
		/** The JSON body as sent. */
		body: string
		as?: Sender
		headers?: Record<string, string>
	}

	/** Sends a JSON body from the web app where the owner is signed in, unless `as` says otherwise. */
	async function send(handler: RouteHandler, { method, body, as = 'owner', headers = {} }: Sent) {
		const sent = new Headers({ 'content-type': 'application/json', ...headers })

		if (as === 'owner' && !sent.has('origin')) {
			sent.set('origin', publicOrigin)
		} else if (as === 'device') {
			sent.set('authorization', `Bearer ${signedIn.auth.devices.create('Shortcut').token}`)
		}

		const withCookie = as === 'owner' || as === 'cookie without origin'

		return sendThroughMiddleware(
			{ auth: signedIn.auth, publicOrigin },
			{
				request: new Request(url, { method, headers: sent, body }),
				cookies: withCookie ? signedIn.session : undefined,
			},
			handler,
		)
	}

	async function subscribe(subscription: SubscriptionChange, options: Partial<Sent> = {}) {
		return send(POST, { method: 'POST', body: JSON.stringify(subscription), ...options })
	}

	async function unsubscribe(endpoint: string, options: Partial<Sent> = {}) {
		return send(DELETE, { method: 'DELETE', body: JSON.stringify({ endpoint }), ...options })
	}

	describe('POST', () => {
		describe('from the web app', () => {
			let subscription: ReturnType<typeof subscriptionFactory.build>
			let response: Response
			let answer: string

			beforeEach(async () => {
				subscription = subscriptionFactory.build({ expirationTime: 1_800_000_000_000 })
				response = await subscribe(subscription)
				answer = await response.text()
			})

			it('answers 201 without the endpoint', () => {
				expect([response.status, JSON.parse(answer)]).toEqual([201, { ok: true }])
			})

			it('stores the subscription in English without an Accept-Language', () => {
				expect(rows()).toMatchObject([
					{
						endpoint: subscription.endpoint,
						p256dh: subscription.keys.p256dh,
						auth: subscription.keys.auth,
						expiresAt: new Date(1_800_000_000_000),
						locale: 'en',
					},
				])
			})

			it('updates the same browser on a second subscribe instead of adding a row', async () => {
				const renewed = subscriptionFactory.build({ endpoint: subscription.endpoint })
				const second = await subscribe(renewed)

				expect([second.status, rows()]).toMatchObject([
					201,
					[{ endpoint: subscription.endpoint, p256dh: renewed.keys.p256dh, expiresAt: null }],
				])
			})
		})

		it.each([
			['ru-RU,ru;q=0.9,en;q=0.8', 'ru'],
			['en-GB,en;q=0.9,ru;q=0.8', 'en'],
			['de-DE', 'en'],
		])('stores the locale picked from Accept-Language %s', async (acceptLanguage, locale) => {
			await subscribe(subscriptionFactory.build(), {
				headers: { 'accept-language': acceptLanguage },
			})

			expect(rows()).toMatchObject([{ locale }])
		})

		it.each<[Sender, number]>([
			['nobody', 401],
			['cookie without origin', 401],
			['device', 403],
		])('answers %s with %i and stores nothing', async (as, status) => {
			const response = await subscribe(subscriptionFactory.build(), { as })

			expect([response.status, rows()]).toEqual([status, []])
		})

		it.each([
			['another origin', { origin: 'https://example.org' }],
			['Sec-Fetch-Site cross-site', { 'sec-fetch-site': 'cross-site' }],
			['Sec-Fetch-Site same-site', { 'sec-fetch-site': 'same-site' }],
		])('answers 403 to a signed-in request from %s', async (_case, headers) => {
			const response = await subscribe(subscriptionFactory.build(), { headers })

			expect([response.status, await response.json(), rows()]).toEqual([
				403,
				{ error: { code: 'cross_site', message: 'Requests from another site are refused.' } },
				[],
			])
		})

		it.each<[string, SubscriptionChange]>([
			['a tailnet endpoint', { endpoint: 'https://stockpot.example.ts.net/api/notes' }],
			['a loopback endpoint', { endpoint: 'https://127.0.0.1/push' }],
			['an endpoint with a port', { endpoint: 'https://fcm.googleapis.com:8443/fcm/send/a' }],
			['a short p256dh', { keys: { p256dh: new Uint8Array(33).fill(4).toBase64() } }],
			['a long auth', { keys: { auth: new Uint8Array(32).toBase64({ alphabet: 'base64url' }) } }],
		])('answers 400 to %s, stores nothing and does not repeat it', async (_case, change) => {
			const body = changedSubscription(change)
			const response = await subscribe(body)
			const answer = await response.text()

			const echoed = [body.endpoint, body.keys?.p256dh, body.keys?.auth].filter(
				(value) => value !== undefined && answer.includes(value),
			)

			expect([response.status, echoed, rows()]).toEqual([400, [], []])
		})

		it('answers 400 to a p256dh of 65 bytes from 0x04 that is off the curve, and does not repeat it', async () => {
			const point = Uint8Array.fromBase64(subscriptionFactory.build().keys.p256dh, {
				alphabet: 'base64url',
			})

			// The point's y no longer fits its x; the length and first byte still pass the schema.
			point[64] = (point[64] + 1) % 256

			const p256dh = point.toBase64({ alphabet: 'base64url', omitPadding: true })
			const response = await subscribe(changedSubscription({ keys: { p256dh } }))
			const answer = await response.text()

			expect([response.status, answer.includes(p256dh), rows()]).toEqual([400, false, []])
			expect(JSON.parse(answer)).toEqual({
				error: {
					code: 'invalid_body',
					message: 'The body does not match what this route accepts.',
					issues: ["keys.p256dh: Use the browser's key: a P-256 point as base64url."],
				},
			})
		})

		it('answers 413 to a body over 4 KiB', async () => {
			const body = JSON.stringify({ ...subscriptionFactory.build(), padding: 'a'.repeat(4096) })
			const response = await send(POST, { method: 'POST', body })

			expect([response.status, rows()]).toEqual([413, []])
		})
	})

	describe('DELETE', () => {
		let removed: string
		let kept: string

		beforeEach(async () => {
			const [first, second] = subscriptionFactory.buildList(2)

			await subscribe(first)
			await subscribe(second)
			removed = first.endpoint
			kept = second.endpoint
		})

		it('removes only that endpoint and answers 204', async () => {
			const response = await unsubscribe(removed)

			expect([response.status, rows().map(({ endpoint }) => endpoint)]).toEqual([204, [kept]])
		})

		it('answers 204 for an unknown endpoint and removes nothing', async () => {
			const response = await unsubscribe(subscriptionFactory.build().endpoint)

			expect([response.status, rows()]).toMatchObject([204, [{}, {}]])
		})

		it.each<[Sender, number]>([
			['nobody', 401],
			['device', 403],
		])('answers %s with %i and removes nothing', async (as, status) => {
			const response = await unsubscribe(removed, { as })

			expect([response.status, rows()]).toMatchObject([status, [{}, {}]])
		})

		it('answers 403 to a signed-in request from another origin', async () => {
			const response = await unsubscribe(removed, { headers: { origin: 'https://example.org' } })

			expect([response.status, rows()]).toMatchObject([403, [{}, {}]])
		})
	})
})
