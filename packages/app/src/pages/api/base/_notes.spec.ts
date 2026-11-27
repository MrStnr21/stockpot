// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test'
import { noteRowFactory } from '#tests/factories/notes'
import { sendThroughMiddleware, signedInInstance, type SignedInInstance } from '#tests/setup/auth'
import { createTestDb, type TestDb } from '#tests/setup/db'
import * as v from 'valibot'

import * as instance from '#/server/db/instance'

import { GET } from './notes'

const publicOrigin = 'http://127.0.0.1:4321'

const snippetSegment = v.strictObject({ text: v.string(), match: v.boolean() })

// A kept note in a page has exactly the fields of a row in the notes list.
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
	snippet: v.nullable(v.array(snippetSegment)),
})

const notesPage = v.strictObject({
	notes: v.array(listedNote),
	nextCursor: v.nullable(v.string()),
	total: v.number(),
})

describe('GET /api/base/notes', () => {
	let db: TestDb
	let signedIn: SignedInInstance

	beforeEach(async () => {
		;({ db } = await createTestDb())
		signedIn = signedInInstance(db, publicOrigin)
		spyOn(instance, 'instanceDb').mockResolvedValue(db)
		await noteRowFactory.transient({ db }).createList(2, { text: 'Kafka', keptAt: new Date() })
		await noteRowFactory.transient({ db }).create({ text: 'Kafka' })
	})

	afterEach(() => {
		mock.restore()
	})

	async function send(query: string, as: 'owner' | 'device' | 'nobody', token?: string) {
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
				request: new Request(`${publicOrigin}/api/base/notes?${query}`, { headers }),
				cookies: as === 'owner' ? signedIn.session : undefined,
			},
			GET,
		)
	}

	it.each([
		['owner', 'categoryId=none'],
		['device', 'categoryId=none'],
		['owner', 'q=kaf'],
		['device', 'q=kaf'],
	] as const)('answers the %s a page for %s', async (as, query) => {
		const response = await send(query, as)
		const body: unknown = await response.json()

		expect([response.status, v.is(notesPage, body), v.parse(notesPage, body).total]).toEqual([
			200,
			true,
			2,
		])
	})

	it.each([
		['neither a category nor a search', ''],
		['both a category and a search', 'categoryId=none&q=kaf'],
		['a page over 100', 'q=kaf&limit=101'],
		['a cursor it did not make', 'categoryId=none&cursor=not-a-cursor'],
	])('answers 400 for %s', async (_case, query) => {
		const response = await send(query, 'owner')

		expect([response.status, await response.json()]).toMatchObject([
			400,
			{ error: { code: 'invalid_query', issues: [expect.any(String)] } },
		])
	})

	it('answers 401 when nobody is signed in', async () => {
		const response = await send('categoryId=none', 'nobody')

		expect(response.status).toBe(401)
	})

	it('answers 401 to a revoked device token', async () => {
		const { device, token } = signedIn.auth.devices.create('Shortcut')
		signedIn.auth.devices.revoke(device.id)

		const response = await send('categoryId=none', 'device', token)

		expect(response.status).toBe(401)
	})
})
