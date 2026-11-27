// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test'
import { categoryRowFactory } from '#tests/factories/categories'
import { noteRowFactory } from '#tests/factories/notes'
import { sendThroughMiddleware, signedInInstance, type SignedInInstance } from '#tests/setup/auth'
import { createTestDb, type TestDb } from '#tests/setup/db'
import * as v from 'valibot'

import * as instance from '#/server/db/instance'

import { GET } from './index'

const publicOrigin = 'http://127.0.0.1:4321'

const url = `${publicOrigin}/api/base`

// A kept note in an answer has exactly the fields of a row in the notes list.
const listedNote = v.strictObject({
	id: v.pipe(v.number(), v.integer()),
	text: v.string(),
	context: v.nullable(v.string()),
	url: v.nullable(v.string()),
	source: v.string(),
	categoryId: v.nullable(v.number()),
	status: v.string(),
	private: v.boolean(),
	createdAt: v.pipe(v.string(), v.isoTimestamp()),
	updatedAt: v.pipe(v.string(), v.isoTimestamp()),
	sense: v.nullable(v.string()),
	flag: v.nullable(v.picklist(['draft', 'unsure'])),
	snippet: v.null(),
})

const baseGroup = v.strictObject({
	categoryId: v.nullable(v.number()),
	count: v.number(),
	notes: v.array(listedNote),
})

const overview = v.strictObject({ total: v.number(), groups: v.array(baseGroup) })

describe('GET /api/base', () => {
	let db: TestDb
	let signedIn: SignedInInstance
	let categoryId: number

	beforeEach(async () => {
		;({ db } = await createTestDb())
		signedIn = signedInInstance(db, publicOrigin)
		spyOn(instance, 'instanceDb').mockResolvedValue(db)
		;({ id: categoryId } = await categoryRowFactory.transient({ db }).create())
		await noteRowFactory.transient({ db }).create({ categoryId, keptAt: new Date() })
		await noteRowFactory.transient({ db }).create({ keptAt: new Date() })
	})

	afterEach(() => {
		mock.restore()
	})

	async function send(as: 'owner' | 'device' | 'nobody', token?: string) {
		const headers = new Headers()

		if (as === 'owner') {
			headers.set('origin', publicOrigin)
		} else if (as === 'device') {
			headers.set(
				'authorization',
				`Bearer ${token ?? signedIn.auth.devices.create('Shortcut').token}`,
			)
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

	it.each(['owner', 'device'] as const)('answers the overview to the %s', async (as) => {
		const response = await send(as)
		const body: unknown = await response.json()

		expect([
			response.status,
			v.is(overview, body),
			v.parse(overview, body).groups.map((group) => [group.categoryId, group.count]),
		]).toEqual([
			200,
			true,
			[
				[categoryId, 1],
				[null, 1],
			],
		])
	})

	it('answers 401 when nobody is signed in', async () => {
		const response = await send('nobody')

		expect(response.status).toBe(401)
	})

	it('answers 401 to a revoked device token', async () => {
		const { device, token } = signedIn.auth.devices.create('Shortcut')
		signedIn.auth.devices.revoke(device.id)

		const response = await send('device', token)

		expect(response.status).toBe(401)
	})
})
