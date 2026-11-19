// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { afterEach, beforeEach, describe, expect, it, setSystemTime } from 'bun:test'
import { faker } from '@faker-js/faker'
import { sendThroughMiddleware, signedInInstance, type SignedInInstance } from '#tests/setup/auth'
import { nextRequestCookies } from '#tests/setup/cookies'
import { createTestDb, type TestDb } from '#tests/setup/db'

import { devices, owner } from '#/server/db/schema/auth'
import { route, type RouteContext } from '#/server/http'

import {
	createDevice,
	deviceTokenPrefix,
	lastUsedInterval,
	listDevices,
	presentedDeviceToken,
	resolveDevice,
	revokeDevice,
	type CreatedDevice,
} from './devices'
import { hashToken, randomToken } from './tokens'

const start = new Date('2026-11-20T09:00:00Z')

function later(milliseconds: number) {
	return new Date(start.getTime() + milliseconds)
}

const publicOrigin = 'http://127.0.0.1:4321'

/** What a request with this `Authorization` header presents. */
function presentedIn(authorization: string) {
	return presentedDeviceToken(new Request(`${publicOrigin}/`, { headers: { authorization } }))
}

/* An authorized route that answers with how the request signed in; capture will be the first real
 * one a device calls. */
const authorizedRoute = route.authorized<RouteContext>((_, signedIn) => Response.json(signedIn))

function lastUsedAt(db: TestDb) {
	return db.select({ lastUsedAt: devices.lastUsedAt }).from(devices).get()?.lastUsedAt
}

describe('devices', () => {
	let db: TestDb

	beforeEach(async () => {
		;({ db } = await createTestDb())
		setSystemTime(start)
	})

	afterEach(() => {
		setSystemTime()
	})

	describe('createDevice', () => {
		let created: CreatedDevice

		beforeEach(() => {
			created = createDevice(db, 'iPhone Shortcut')
		})

		it('returns a prefixed token of 256 random bits', () => {
			expect(created.token).toMatch(/^sp1_[\w-]{43}$/u)
		})

		it('returns the device with a hint of the token', () => {
			expect(created.device).toMatchObject({
				name: 'iPhone Shortcut',
				hint: `sp1_…${created.token.slice(-4)}`,
				createdAt: start,
				lastUsedAt: null,
			})
		})

		it('stores only the hash of the token', () => {
			const row = db.select().from(devices).get()

			expect([row?.tokenHash, JSON.stringify(row).includes(created.token)]).toEqual([
				hashToken(created.token),
				false,
			])
		})

		it('gives every device a token of its own', () => {
			expect(createDevice(db, 'MCP client').token).not.toBe(created.token)
		})
	})

	describe('listDevices', () => {
		let tokens: string[]

		beforeEach(() => {
			const first = createDevice(db, 'iPhone Shortcut')

			setSystemTime(later(1000))

			const second = createDevice(db, 'MCP client')

			tokens = [first.token, second.token]
		})

		it('lists devices newest first', () => {
			expect(listDevices(db).map((device) => device.name)).toEqual([
				'MCP client',
				'iPhone Shortcut',
			])
		})

		it('contains neither a token nor the hash of one', () => {
			const listed = JSON.stringify(listDevices(db))
			const secrets = tokens.flatMap((token) => [token, hashToken(token)])

			expect(secrets.filter((secret) => listed.includes(secret))).toEqual([])
		})
	})

	describe('presentedDeviceToken', () => {
		it('reads a device token from a bearer header, in any case of the scheme', () => {
			const { token } = createDevice(db, 'iPhone Shortcut')

			expect(
				[`Bearer ${token}`, `bearer ${token}`].map((authorization) => presentedIn(authorization)),
			).toEqual([token, token])
		})

		it('returns null for a bearer token with the prefix but not the shape of a device token', () => {
			const short = `Bearer sp1_${faker.string.alphanumeric(42)}`
			const withSymbol = `Bearer sp1_${faker.string.alphanumeric(42)}!`

			expect(
				['Bearer sp1_', short, withSymbol].map((authorization) => presentedIn(authorization)),
			).toEqual([null, null, null])
		})

		it('returns undefined without a bearer token with the device prefix', () => {
			const basic = `Basic ${faker.string.alphanumeric(24)}`
			const otherBearer = `Bearer ${faker.string.alphanumeric(64)}`

			expect([
				presentedDeviceToken(new Request(`${publicOrigin}/`)),
				...[basic, otherBearer].map((authorization) => presentedIn(authorization)),
			]).toEqual([undefined, undefined, undefined])
		})
	})

	describe('resolveDevice', () => {
		let created: CreatedDevice

		beforeEach(() => {
			db.insert(owner)
				.values({ id: 1, passwordHash: faker.string.alphanumeric(32) })
				.run()
			created = createDevice(db, 'iPhone Shortcut')
		})

		it('signs the owner in by device', () => {
			expect(resolveDevice(db, created.token)).toEqual({ id: 1, via: 'device' })
		})

		it('signs nobody in with an unknown token', () => {
			expect(resolveDevice(db, `${deviceTokenPrefix}${randomToken()}`)).toBeNull()
		})

		it('signs nobody in once the device is revoked', () => {
			const isRevoked = revokeDevice(db, created.device.id)

			expect([isRevoked, resolveDevice(db, created.token)]).toEqual([true, null])
		})

		it('signs nobody in while the instance has no owner', () => {
			db.delete(owner).run()

			expect(resolveDevice(db, created.token)).toBeNull()
		})

		describe('when the token is used', () => {
			beforeEach(() => {
				resolveDevice(db, created.token)
			})

			it('records the time of first use', () => {
				expect(lastUsedAt(db)).toEqual(start)
			})

			it('keeps that time for requests within a minute', () => {
				setSystemTime(later(lastUsedInterval - 1))
				resolveDevice(db, created.token)

				expect(lastUsedAt(db)).toEqual(start)
			})

			it('moves it on a request a minute later', () => {
				setSystemTime(later(lastUsedInterval))
				resolveDevice(db, created.token)

				expect(lastUsedAt(db)).toEqual(later(lastUsedInterval))
			})
		})
	})

	describe('through the middleware and the auth resolver', () => {
		let instance: SignedInInstance
		let created: CreatedDevice

		beforeEach(() => {
			instance = signedInInstance(db, publicOrigin)
			created = instance.auth.devices.create('iPhone Shortcut')
		})

		/** A POST to the authorized route, from a client that sends neither Origin nor Sec-Fetch-Site. */
		async function post(headers: Record<string, string>, withSession = false) {
			const request = new Request(`${publicOrigin}/api/notes`, { method: 'POST', headers })
			const cookies = withSession ? nextRequestCookies(instance.session) : undefined

			return sendThroughMiddleware(
				{ auth: instance.auth, publicOrigin },
				{ request, cookies },
				authorizedRoute,
			)
		}

		it('accepts a bearer POST, signed in by device', async () => {
			const response = await post({ authorization: `Bearer ${created.token}` })

			expect([response.status, await response.json()]).toEqual([200, { id: 1, via: 'device' }])
		})

		it('refuses the same POST with only the session cookie', async () => {
			const response = await post({}, true)

			expect(response.status).toBe(401)
		})

		it.each([
			['a malformed device token', () => 'Bearer sp1_'],
			['an unknown device token', () => `Bearer ${deviceTokenPrefix}${randomToken()}`],
			['a bearer token that is not a device token', () => `Bearer ${randomToken()}`],
		])('answers 401 to %s', async (_, authorization) => {
			const response = await post({ authorization: authorization() })

			expect(response.status).toBe(401)
		})

		it('refuses a revoked token even next to a session cookie', async () => {
			instance.auth.devices.revoke(created.device.id)

			const response = await post(
				{ authorization: `Bearer ${created.token}`, origin: publicOrigin },
				true,
			)

			expect(response.status).toBe(401)
		})

		it('signs the web app in by session when the request has no device token', async () => {
			const response = await post({ origin: publicOrigin }, true)

			expect(await response.json()).toEqual({ id: 1, via: 'session' })
		})
	})

	describe('revokeDevice', () => {
		it('returns false for a device that does not exist', () => {
			expect(revokeDevice(db, faker.number.int({ min: 1000, max: 9999 }))).toBe(false)
		})
	})
})
