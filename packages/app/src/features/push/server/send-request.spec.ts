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
import { fakePushFetch, pushClient, pushRequest, type PushClient } from '#tests/setup/push'
import * as v from 'valibot'

import type { Locale } from '#/lib/i18n'
import { log, type Logger } from '#/server/log'

import { digestMessage, readyMessage } from './messages'
import { createPushSender, type PushFetch } from './send'
import { saveSubscription } from './subscriptions'
import { vapidKeys } from './vapid'

const subject = 'https://stockpot.example.org/source'

const origin = 'https://stockpot.example.ts.net'

const start = new Date('2026-11-27T08:30:00Z')

const hourMs = 60 * 60 * 1000

const jwtHeaderSchema = v.object({ typ: v.string(), alg: v.string() })

const jwtClaimsSchema = v.object({ aud: v.string(), sub: v.string(), exp: v.number() })

const authorizationPattern = /^vapid t=(?<jwt>[\w-]+\.[\w-]+\.[\w-]+), k=(?<key>[\w-]+)$/u

function fromBase64Url(value: string) {
	return Uint8Array.fromBase64(value, { alphabet: 'base64url' })
}

function jwtPart<TSchema extends v.GenericSchema>(
	schema: TSchema,
	part: string,
): v.InferOutput<TSchema> {
	const json = new TextDecoder().decode(fromBase64Url(part))

	return v.parse(schema, JSON.parse(json))
}

function readyKafka(locale: Locale) {
	return readyMessage(
		{ noteId: 7, term: 'Kafka', isPrivate: false, category: 'Technology', report: null },
		locale,
	)
}

function serviceEndpoint(host: string) {
	return `https://${host}/${faker.string.alphanumeric(40)}`
}

/** The authorization header each push service host got, one set of distinct values per host. */
function authorizationsByHost(fetchMock: Mock<PushFetch>) {
	const byHost = new Map<string, Set<string | null>>()

	for (const [url, init] of fetchMock.mock.calls) {
		const { hostname } = new URL(url)
		const seen = byHost.get(hostname) ?? new Set()

		seen.add(new Headers(init.headers).get('authorization'))
		byHost.set(hostname, seen)
	}

	return byHost
}

describe('createPushSender requests', () => {
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

	async function subscribed(locale: Locale = 'en', endpoint?: string): Promise<PushClient> {
		const client = await pushClient(endpoint)

		saveSubscription(db, client.subscription, locale)

		return client
	}

	function sender(fetchMock: Mock<PushFetch>) {
		return createPushSender({ db, subject, origin, fetch: fetchMock })
	}

	describe('the request', () => {
		let timeout: Mock<typeof AbortSignal.timeout>
		let signal: AbortSignal

		beforeEach(() => {
			;({ signal } = new AbortController())
			timeout = spyOn(AbortSignal, 'timeout').mockImplementation(() => signal)
		})

		afterEach(() => {
			timeout.mockRestore()
		})

		it('posts once, refuses redirects and gives up after 10 seconds', async () => {
			const client = await subscribed()
			const fetchMock = fakePushFetch()

			await sender(fetchMock).send(readyKafka)

			const { url, init } = pushRequest(fetchMock)

			expect(fetchMock).toHaveBeenCalledTimes(1)
			expect(url).toBe(client.subscription.endpoint)
			expect(init).toMatchObject({ method: 'POST', redirect: 'error' })
			expect(timeout).toHaveBeenCalledWith(10_000)
			expect(init.signal).toBe(signal)
		})

		it('carries the RFC 8030 headers and a 4096-byte padded body', async () => {
			await subscribed()

			const fetchMock = fakePushFetch()

			await sender(fetchMock).send((locale) =>
				digestMessage({ notes: [{ term: 'Bun', isPrivate: false }], minutes: 1 }, locale),
			)

			const { headers, body } = pushRequest(fetchMock)

			expect(Object.fromEntries(headers)).toMatchObject({
				ttl: '43200',
				urgency: 'normal',
				topic: 'digest',
				'content-encoding': 'aes128gcm',
				'content-type': 'application/octet-stream',
			})
			expect(body.byteLength).toBe(4096)
		})

		it('has no topic for a Ready message', async () => {
			await subscribed()

			const fetchMock = fakePushFetch()

			await sender(fetchMock).send(readyKafka)

			const { headers } = pushRequest(fetchMock)

			expect(headers.get('ttl')).toBe('86400')
			expect(headers.has('topic')).toBe(false)
		})
	})

	describe('the payload', () => {
		it('is the declarative message, encrypted for the browser', async () => {
			const client = await subscribed()
			const fetchMock = fakePushFetch()

			await sender(fetchMock).send(readyKafka)

			const sent = await client.decrypt(pushRequest(fetchMock).body)

			expect(JSON.parse(sent)).toEqual({
				web_push: 8030,
				notification: {
					title: 'Ready: Kafka',
					body: 'Technology · tap to read',
					navigate: 'https://stockpot.example.ts.net/notes/7',
					tag: 'ready-7',
					lang: 'en',
				},
			})
		})

		it('is in Russian for a Russian subscription', async () => {
			const english = await subscribed('en')
			const russian = await subscribed('ru')
			const fetchMock = fakePushFetch()

			await sender(fetchMock).send(readyKafka)

			const bodies = new Map(
				fetchMock.mock.calls.map((_call, index) => {
					const { url, body } = pushRequest(fetchMock, index)

					return [url, body] as const
				}),
			)

			const russianBody = bodies.get(russian.subscription.endpoint) ?? new Uint8Array()
			const englishBody = bodies.get(english.subscription.endpoint) ?? new Uint8Array()

			expect(JSON.parse(await russian.decrypt(russianBody))).toMatchObject({
				notification: { title: 'Готово: Kafka', lang: 'ru' },
			})
			expect(JSON.parse(await english.decrypt(englishBody))).toMatchObject({
				notification: { title: 'Ready: Kafka', lang: 'en' },
			})
		})
	})

	describe('the VAPID header', () => {
		it('signs a JWT for the push service with the instance key (RFC 8292)', async () => {
			const client = await subscribed('en', serviceEndpoint('web.push.apple.com'))
			const fetchMock = fakePushFetch()

			await sender(fetchMock).send(readyKafka)

			const { publicKey } = await vapidKeys(db)
			const authorization = pushRequest(fetchMock).headers.get('authorization') ?? ''
			const groups = authorizationPattern.exec(authorization)?.groups
			const [header = '', claims = '', signature = ''] = (groups?.jwt ?? '').split('.')

			expect(groups?.key).toBe(publicKey)
			expect(jwtPart(jwtHeaderSchema, header)).toEqual({ typ: 'JWT', alg: 'ES256' })

			const { aud, sub, exp } = jwtPart(jwtClaimsSchema, claims)

			expect({ aud, sub }).toEqual({
				aud: new URL(client.subscription.endpoint).origin,
				sub: subject,
			})
			expect(exp * 1000).toBeGreaterThan(start.getTime())
			expect(exp * 1000).toBeLessThanOrEqual(start.getTime() + 24 * hourMs)

			const verifying = await crypto.subtle.importKey(
				'raw',
				fromBase64Url(publicKey),
				{ name: 'ECDSA', namedCurve: 'P-256' },
				false,
				['verify'],
			)

			const signed = new TextEncoder().encode(`${header}.${claims}`)
			const algorithm = { name: 'ECDSA', hash: 'SHA-256' }

			expect(
				await crypto.subtle.verify(algorithm, verifying, fromBase64Url(signature), signed),
			).toBe(true)
		})

		it('reuses one header per push service for an hour, then signs a new one', async () => {
			await subscribed('en', serviceEndpoint('fcm.googleapis.com'))
			await subscribed('en', serviceEndpoint('fcm.googleapis.com'))
			await subscribed('en', serviceEndpoint('updates.push.services.mozilla.com'))

			const fetchMock = fakePushFetch()
			const pushSender = sender(fetchMock)

			await pushSender.send(readyKafka)

			const first = authorizationsByHost(fetchMock)

			fetchMock.mockClear()
			setSystemTime(new Date(start.getTime() + hourMs - 1000))
			await pushSender.send(readyKafka)

			const withinTheHour = authorizationsByHost(fetchMock)

			fetchMock.mockClear()
			setSystemTime(new Date(start.getTime() + hourMs))
			await pushSender.send(readyKafka)

			const afterTheHour = authorizationsByHost(fetchMock)
			const [google] = first.get('fcm.googleapis.com') ?? []
			const [mozilla] = first.get('updates.push.services.mozilla.com') ?? []

			expect(first.get('fcm.googleapis.com')).toEqual(new Set([google]))
			expect(google).not.toBe(mozilla)
			expect(withinTheHour).toEqual(first)
			expect(afterTheHour.get('fcm.googleapis.com')?.size).toBe(1)
			expect(afterTheHour.get('fcm.googleapis.com')?.has(google ?? '')).toBe(false)
			expect(afterTheHour.get('updates.push.services.mozilla.com')?.has(mozilla ?? '')).toBe(false)
		})
	})
})
