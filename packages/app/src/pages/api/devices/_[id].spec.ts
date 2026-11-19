// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test'
import { sendThroughMiddleware, signedInInstance, type SignedInInstance } from '#tests/setup/auth'
import { nextRequestCookies } from '#tests/setup/cookies'
import { createTestDb } from '#tests/setup/db'

import * as auth from '#/server/auth'
import { route, type RouteContext } from '#/server/http'

import { DELETE } from './[id]'

const publicOrigin = 'http://127.0.0.1:4321'

// Any route a device may call; capture will be the first.
const authorizedRoute = route.authorized<RouteContext>(() => new Response('saved'))

describe('DELETE /api/devices/[id]', () => {
	let instance: SignedInInstance
	let device: auth.CreatedDevice

	beforeEach(async () => {
		const { db } = await createTestDb()

		instance = signedInInstance(db, publicOrigin)
		spyOn(auth, 'instanceAuth').mockResolvedValue(instance.auth)
		device = instance.auth.devices.create('iPhone Shortcut')
	})

	afterEach(() => {
		mock.restore()
	})

	/** A DELETE from the web app, where the owner is signed in. */
	async function revokeFromWebApp(id: string) {
		const request = new Request(`${publicOrigin}/api/devices/${id}`, {
			method: 'DELETE',
			headers: { origin: publicOrigin },
		})

		return sendThroughMiddleware(
			{ auth: instance.auth, publicOrigin },
			{ request, cookies: nextRequestCookies(instance.session), params: { id } },
			DELETE,
		)
	}

	/** A DELETE sent with a device token, as a Shortcut sends it: without `Origin`. */
	async function revokeWithToken(id: string, token: string) {
		const request = new Request(`${publicOrigin}/api/devices/${id}`, {
			method: 'DELETE',
			headers: { authorization: `Bearer ${token}` },
		})

		return sendThroughMiddleware(
			{ auth: instance.auth, publicOrigin },
			{ request, params: { id } },
			DELETE,
		)
	}

	/** The status of a POST that a device sends to an authorized route. */
	async function postStatus(token: string) {
		const request = new Request(`${publicOrigin}/api/notes`, {
			method: 'POST',
			headers: { authorization: `Bearer ${token}` },
		})

		const response = await sendThroughMiddleware(
			{ auth: instance.auth, publicOrigin },
			{ request },
			authorizedRoute,
		)

		return response.status
	}

	describe('from the web app', () => {
		let status: number

		beforeEach(async () => {
			;({ status } = await revokeFromWebApp(String(device.device.id)))
		})

		it('answers 204 and removes the device from the list', () => {
			expect([status, instance.auth.devices.list()]).toEqual([204, []])
		})

		it('makes the revoked token get 401', async () => {
			expect(await postStatus(device.token)).toBe(401)
		})

		it('answers 404 when the device is revoked again', async () => {
			const response = await revokeFromWebApp(String(device.device.id))

			expect([response.status, await response.json()]).toEqual([
				404,
				{ error: { code: 'not_found', message: 'There is no such device.' } },
			])
		})
	})

	it('leaves other devices working', async () => {
		const other = instance.auth.devices.create('MCP client')

		await revokeFromWebApp(String(device.device.id))

		expect(await postStatus(other.token)).toBe(200)
	})

	it.each(['abc', '0', '07', '-1', '1.5', '9'.repeat(16)])(
		'answers 400 for the id %p',
		async (id) => {
			const response = await revokeFromWebApp(id)

			expect([response.status, await response.json()]).toEqual([
				400,
				{ error: { code: 'invalid_id', message: 'A device id is a positive integer.' } },
			])
		},
	)

	describe('with a device token', () => {
		it('answers 403 to revoking another device, which keeps working', async () => {
			const other = instance.auth.devices.create('MCP client')
			const response = await revokeWithToken(String(other.device.id), device.token)

			expect([response.status, await postStatus(other.token)]).toEqual([403, 200])
		})

		it('answers 403 to revoking its own device', async () => {
			const response = await revokeWithToken(String(device.device.id), device.token)

			expect([response.status, instance.auth.devices.list().length]).toEqual([403, 1])
		})
	})

	it('answers 401 when nobody is signed in', async () => {
		const request = new Request(`${publicOrigin}/api/devices/${device.device.id}`, {
			method: 'DELETE',
			headers: { origin: publicOrigin },
		})

		const response = await sendThroughMiddleware(
			{ auth: instance.auth, publicOrigin },
			{ request, params: { id: String(device.device.id) } },
			DELETE,
		)

		expect(response.status).toBe(401)
	})
})
