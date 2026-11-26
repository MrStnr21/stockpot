// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test'
import { noteRowFactory } from '#tests/factories/notes'
import { sendThroughMiddleware, signedInInstance, type SignedInInstance } from '#tests/setup/auth'
import { createTestDb, type TestDb } from '#tests/setup/db'

import * as instance from '#/server/db/instance'

import { GET } from './counts'

const publicOrigin = 'http://127.0.0.1:4321'

const url = `${publicOrigin}/api/notes/counts`

describe('GET /api/notes/counts', () => {
	let db: TestDb
	let signedIn: SignedInInstance

	beforeEach(async () => {
		;({ db } = await createTestDb())
		signedIn = signedInInstance(db, publicOrigin)
		spyOn(instance, 'instanceDb').mockResolvedValue(db)
		await noteRowFactory.transient({ db }).createList(2, { status: 'ready' })
	})

	afterEach(() => {
		mock.restore()
	})

	async function send(as: 'owner' | 'device' | 'nobody') {
		const headers = new Headers()

		if (as === 'owner') {
			headers.set('origin', publicOrigin)
		} else if (as === 'device') {
			headers.set('authorization', `Bearer ${signedIn.auth.devices.create('Shortcut').token}`)
		}

		return sendThroughMiddleware(
			{ auth: signedIn.auth, publicOrigin },
			{
				request: new Request(url, { headers }),
				cookies: as === 'owner' ? signedIn.session : undefined,
			},
			GET,
		)
	}

	it.each(['owner', 'device'] as const)('answers the counts to the %s', async (as) => {
		const response = await send(as)

		expect([response.status, await response.json()]).toEqual([
			200,
			{ counts: [{ categoryId: null, status: 'ready', count: 2 }] },
		])
	})

	it('answers 401 when nobody is signed in', async () => {
		const response = await send('nobody')

		expect(response.status).toBe(401)
	})
})
