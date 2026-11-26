// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import {
	afterEach,
	beforeEach,
	describe,
	expect,
	it,
	setSystemTime,
	spyOn,
	type Mock,
} from 'bun:test'
import { faker } from '@faker-js/faker'
import { createTestDb, type TestDb } from '#tests/setup/db'
import { fakePushFetch, pushClient, type PushAnswer, type PushClient } from '#tests/setup/push'
import { eq } from 'drizzle-orm'

import type { Locale } from '#/lib/i18n'
import { pushSubscriptions } from '#/server/db/schema/push'
import { log, type Logger } from '#/server/log'

import { readyMessage } from './messages'
import { createPushSender, type PushFetch } from './send'
import { saveSubscription } from './subscriptions'
import { vapidKeys } from './vapid'

const subject = 'https://stockpot.example.org/source'

const origin = 'https://stockpot.example.ts.net'

const start = new Date('2026-11-27T08:30:00Z')

function readyKafka(locale: Locale) {
	return readyMessage(
		{ noteId: 7, term: 'Kafka', isPrivate: false, category: 'Technology', report: null },
		locale,
	)
}

function hostOf({ subscription }: PushClient) {
	return new URL(subscription.endpoint).hostname
}

describe('createPushSender', () => {
	let db: TestDb
	let logs: Mock<Logger['info']>[]

	beforeEach(async () => {
		setSystemTime(start)
		;({ db } = await createTestDb())
		logs = (['info', 'warn', 'error'] as const).map((level) =>
			spyOn(log, level).mockImplementation(() => {
				// The spy records the call; nothing is written.
			}),
		)
	})

	afterEach(() => {
		setSystemTime()

		for (const spy of logs) {
			spy.mockRestore()
		}
	})

	async function subscribed(locale: Locale = 'en'): Promise<PushClient> {
		const client = await pushClient()

		saveSubscription(db, client.subscription, locale)

		return client
	}

	function sender(fetchMock: Mock<PushFetch>) {
		return createPushSender({ db, subject, origin, fetch: fetchMock })
	}

	function endpoints() {
		return db
			.select({ endpoint: pushSubscriptions.endpoint })
			.from(pushSubscriptions)
			.all()
			.map((row) => row.endpoint)
	}

	function idOf({ subscription }: PushClient) {
		return db
			.select({ id: pushSubscriptions.id })
			.from(pushSubscriptions)
			.where(eq(pushSubscriptions.endpoint, subscription.endpoint))
			.get()?.id
	}

	it('counts a notification the push service accepts as sent and keeps the subscription', async () => {
		const client = await subscribed()

		expect(await sender(fakePushFetch()).send(readyKafka)).toEqual({
			sent: 1,
			removed: 0,
			failed: 0,
		})
		expect(endpoints()).toEqual([client.subscription.endpoint])
	})

	describe('when the push service no longer knows the subscription', () => {
		it('deletes the subscription on 410 Gone', async () => {
			const kept = await subscribed()
			const gone = await subscribed()

			const fetchMock = fakePushFetch((url) =>
				url === gone.subscription.endpoint
					? new Response('{"reason":"Unregistered"}', { status: 410 })
					: new Response(null, { status: 201 }),
			)

			expect(await sender(fetchMock).send(readyKafka)).toEqual({ sent: 1, removed: 1, failed: 0 })
			expect(endpoints()).toEqual([kept.subscription.endpoint])
		})

		it('deletes the subscription on 404 Not Found', async () => {
			await subscribed()

			const fetchMock = fakePushFetch(() => new Response(null, { status: 404 }))

			expect(await sender(fetchMock).send(readyKafka)).toEqual({ sent: 0, removed: 1, failed: 0 })
			expect(endpoints()).toEqual([])
		})
	})

	describe('when the push service fails', () => {
		it.each([500, 429, 403, 413])('keeps the subscription on %p and resolves', async (status) => {
			const client = await subscribed()
			const fetchMock = fakePushFetch(() => new Response(null, { status }))

			expect(await sender(fetchMock).send(readyKafka)).toEqual({ sent: 0, removed: 0, failed: 1 })
			expect(endpoints()).toEqual([client.subscription.endpoint])
		})

		it.each([
			['a timeout', new DOMException('The operation timed out.', 'TimeoutError')],
			['a redirect', new TypeError('Unexpected redirect')],
		])('keeps the subscription after %s and resolves', async (_name, error) => {
			const client = await subscribed()
			const fetchMock = fakePushFetch(() => error)

			expect(await sender(fetchMock).send(readyKafka)).toEqual({ sent: 0, removed: 0, failed: 1 })
			expect(endpoints()).toEqual([client.subscription.endpoint])
			expect(log.warn).toHaveBeenCalledWith('Could not send a notification', {
				subscription: idOf(client),
				host: hostOf(client),
				error: error.name,
			})
		})

		it.each([
			['a plain word', '{"reason":"BadJwtToken"}', 'BadJwtToken'],
			['not a word', '{"reason":"Bad token: abc"}', null],
			['not JSON', 'Forbidden', null],
			['over 1 KiB', `{"reason":"BadJwtToken","pad":"${'x'.repeat(1100)}"}`, null],
		])('logs a reason that is %s as %p', async (_name, text, reason) => {
			const client = await subscribed()

			await sender(fakePushFetch(() => new Response(text, { status: 403 }))).send(readyKafka)

			expect(log.warn).toHaveBeenCalledWith('A push service refused a notification', {
				subscription: idOf(client),
				host: hostOf(client),
				status: 403,
				...(reason !== null && { reason }),
			})
		})
	})

	describe('before sending', () => {
		it('deletes an expired subscription without a request', async () => {
			const { subscription } = await pushClient()

			saveSubscription(db, { ...subscription, expirationTime: start.getTime() - 1 }, 'en')

			const fetchMock = fakePushFetch()

			expect(await sender(fetchMock).send(readyKafka)).toEqual({ sent: 0, removed: 1, failed: 0 })
			expect(fetchMock).not.toHaveBeenCalled()
			expect(endpoints()).toEqual([])
		})

		it('deletes a subscription outside the push services without a request', async () => {
			const { subscription } = await pushClient()

			db.insert(pushSubscriptions)
				.values({ endpoint: `${origin}/push`, ...subscription.keys, locale: 'en' })
				.run()

			const fetchMock = fakePushFetch()

			expect(await sender(fetchMock).send(readyKafka)).toEqual({ sent: 0, removed: 1, failed: 0 })
			expect(fetchMock).not.toHaveBeenCalled()
			expect(endpoints()).toEqual([])
		})

		it('sends nothing when there is no message', async () => {
			await subscribed()

			const fetchMock = fakePushFetch()

			expect(await sender(fetchMock).send(() => null)).toEqual({ sent: 0, removed: 0, failed: 0 })
			expect(fetchMock).not.toHaveBeenCalled()
		})

		it('sends nothing without subscriptions', async () => {
			const fetchMock = fakePushFetch()

			expect(await sender(fetchMock).send(readyKafka)).toEqual({ sent: 0, removed: 0, failed: 0 })
			expect(fetchMock).not.toHaveBeenCalled()
		})
	})

	describe('the log', () => {
		it('never holds an endpoint, a key or a JWT', async () => {
			const clients = await Promise.all(
				Array.from({ length: 5 }, async () => subscribed(faker.helpers.arrayElement(['en', 'ru']))),
			)

			const expired = await pushClient()

			saveSubscription(db, { ...expired.subscription, expirationTime: start.getTime() - 1 }, 'en')

			const answers: PushAnswer[] = [
				new Response(null, { status: 201 }),
				new Response(null, { status: 410 }),
				new Response('{"reason":"BadJwtToken"}', { status: 403 }),
				new Response(null, { status: 500 }),
				new DOMException('The operation timed out.', 'TimeoutError'),
			]

			const fetchMock = fakePushFetch((url) => {
				const index = clients.findIndex((client) => client.subscription.endpoint === url)

				return answers[index] ?? new Response(null, { status: 201 })
			})

			await sender(fetchMock).send(readyKafka)

			const { publicKey, privateKey } = await vapidKeys(db)

			const authorizations = fetchMock.mock.calls.map(
				([, init]) => new Headers(init.headers).get('authorization') ?? 'missing',
			)

			const subscriptionSecrets = [...clients, expired].flatMap(({ subscription }) => [
				subscription.endpoint,
				subscription.endpoint.slice(-20),
				subscription.keys.p256dh,
				subscription.keys.auth,
			])

			const logged = JSON.stringify(logs.map((spy) => spy.mock.calls))

			expect(logs.flatMap((spy) => spy.mock.calls).length).toBeGreaterThanOrEqual(5)

			for (const secret of [publicKey, privateKey, ...authorizations, ...subscriptionSecrets]) {
				expect(logged).not.toContain(secret)
			}
		})
	})
})
