// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test'
import {
	sendThroughMiddleware,
	signedInInstance,
	type RouteHandler,
	type SignedInInstance,
} from '#tests/setup/auth'
import { nextRequestCookies } from '#tests/setup/cookies'
import { createTestDb, type TestDb } from '#tests/setup/db'
import * as v from 'valibot'

import * as auth from '#/server/auth'
import { hashToken } from '#/server/auth/tokens'

import { GET, POST } from './index'

const publicOrigin = 'http://127.0.0.1:4321'

const url = `${publicOrigin}/api/devices`

// A device in an answer has exactly these fields, so neither the token nor its hash can slip in.
const listedDevice = v.strictObject({
	id: v.pipe(v.number(), v.integer()),
	name: v.string(),
	hint: v.pipe(v.string(), v.regex(/^sp1_…[\w-]{4}$/u)),
	createdAt: v.pipe(v.string(), v.isoTimestamp()),
	lastUsedAt: v.null(),
})

const createdAnswer = v.strictObject({
	device: listedDevice,
	token: v.pipe(v.string(), v.regex(/^sp1_[\w-]{43}$/u)),
})

const deviceList = v.strictObject({ devices: v.array(listedDevice) })

/** The init of a POST that creates a device with this name. */
function createBody(name: string) {
	return { method: 'POST', body: JSON.stringify({ name }) }
}

describe('/api/devices', () => {
	let db: TestDb
	let instance: SignedInInstance

	beforeEach(async () => {
		;({ db } = await createTestDb())
		instance = signedInInstance(db, publicOrigin)
		spyOn(auth, 'instanceAuth').mockResolvedValue(instance.auth)
	})

	afterEach(() => {
		mock.restore()
	})

	async function send(handler: RouteHandler, request: Request, withSession: boolean) {
		const cookies = withSession ? nextRequestCookies(instance.session) : undefined

		return sendThroughMiddleware(
			{ auth: instance.auth, publicOrigin },
			{ request, cookies },
			handler,
		)
	}

	/** A request from the web app, where the owner is signed in. */
	async function fromWebApp(handler: RouteHandler, init: RequestInit = {}) {
		const headers = { origin: publicOrigin, 'content-type': 'application/json' }

		return send(handler, new Request(url, { headers, ...init }), true)
	}

	/** A request from a client signed in with a device token. */
	async function fromDevice(handler: RouteHandler, token: string, init: RequestInit = {}) {
		const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' }

		return send(handler, new Request(url, { headers, ...init }), false)
	}

	async function createDevice(name: string) {
		const response = await fromWebApp(POST, createBody(name))

		return v.parse(createdAnswer, await response.json())
	}

	describe('POST', () => {
		describe('from the web app', () => {
			let response: Response

			beforeEach(async () => {
				response = await fromWebApp(POST, createBody('  iPhone Shortcut  '))
			})

			it('answers 201, not to be cached', () => {
				expect([response.status, response.headers.get('cache-control')]).toEqual([201, 'no-store'])
			})

			it('answers with the device, its trimmed name, and its token, which the hint ends with', async () => {
				const { device, token } = v.parse(createdAnswer, await response.json())

				expect([device.name, device.hint.slice(-4)]).toEqual(['iPhone Shortcut', token.slice(-4)])
			})
		})

		it('answers 400 for a device without a name', async () => {
			const response = await fromWebApp(POST, createBody(' '))

			expect([response.status, await response.json()]).toEqual([
				400,
				{
					error: {
						code: 'invalid_body',
						message: 'The body does not match what this route accepts.',
						issues: ['name: Name the device, such as "iPhone Shortcut".'],
					},
				},
			])
		})

		it('answers 403 to a device token and creates nothing', async () => {
			const { token } = await createDevice('iPhone Shortcut')
			const response = await fromDevice(POST, token, createBody('Another token'))

			expect([response.status, await response.json(), instance.auth.devices.list().length]).toEqual(
				[
					403,
					{
						error: {
							code: 'session_required',
							message: 'Sign in on the web to do this; a device token cannot.',
						},
					},
					1,
				],
			)
		})

		it('answers 401 when nobody is signed in', async () => {
			const request = new Request(url, {
				headers: { origin: publicOrigin, 'content-type': 'application/json' },
				...createBody('iPhone Shortcut'),
			})

			const response = await send(POST, request, false)

			expect(response.status).toBe(401)
		})
	})

	describe('GET', () => {
		let token: string
		let deviceId: number

		beforeEach(async () => {
			;({
				token,
				device: { id: deviceId },
			} = await createDevice('iPhone Shortcut'))
		})

		it('lists the devices with their hints', async () => {
			const response = await fromWebApp(GET)
			const { devices } = v.parse(deviceList, await response.json())

			expect([
				response.status,
				devices.map((device) => [device.id, device.name, device.hint]),
			]).toEqual([200, [[deviceId, 'iPhone Shortcut', `sp1_…${token.slice(-4)}`]]])
		})

		it('answers 403 to a device token', async () => {
			const response = await fromDevice(GET, token)

			expect(response.status).toBe(403)
		})

		it('answers 401 when nobody is signed in', async () => {
			const response = await send(GET, new Request(url), false)

			expect(response.status).toBe(401)
		})
	})

	describe('after a device is created', () => {
		let token: string
		let answers: string[]

		beforeEach(async () => {
			;({ token } = await createDevice('iPhone Shortcut'))

			const responses = [
				await fromWebApp(GET),
				await fromWebApp(POST, createBody('')),
				await fromDevice(GET, token),
				await fromDevice(POST, token, createBody('Another token')),
			]

			answers = await Promise.all(responses.map(async (response) => response.text()))
		})

		it('never shows its token or the token hash again, in a list or an error', () => {
			const secrets = [token, hashToken(token)]

			expect(answers.filter((answer) => secrets.some((secret) => answer.includes(secret)))).toEqual(
				[],
			)
		})
	})
})
