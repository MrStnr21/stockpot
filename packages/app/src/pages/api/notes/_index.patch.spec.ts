// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test'
import { categoryRowFactory } from '#tests/factories/categories'
import { noteRowFactory } from '#tests/factories/notes'
import { sendThroughMiddleware, signedInInstance, type SignedInInstance } from '#tests/setup/auth'
import { createTestDb, type TestDb } from '#tests/setup/db'
import { eq } from 'drizzle-orm'
import * as v from 'valibot'

import * as instance from '#/server/db/instance'
import { notes } from '#/server/db/schema/notes'

import { PATCH } from './index'

const publicOrigin = 'http://127.0.0.1:4321'

const changedNote = v.object({ status: v.string(), categoryId: v.nullable(v.number()) })

const bulkResult = v.strictObject({
	id: v.number(),
	outcome: v.picklist(['changed', 'unchanged', 'not_found', 'conflict']),
	note: v.nullable(changedNote),
})

const bulkAnswer = v.strictObject({ results: v.array(bulkResult) })

interface BulkBody {
	readonly ids: number[]
	readonly categoryId?: number
	readonly status?: string
}

interface Sent {
	readonly body: BulkBody
	readonly contentType?: string
	readonly as?: 'owner' | 'device' | 'nobody' | 'another site'
}

describe('PATCH /api/notes', () => {
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

	async function send({ body, contentType = 'application/json', as = 'owner' }: Sent) {
		const headers = new Headers({ 'content-type': contentType })

		if (as === 'owner' || as === 'another site') {
			headers.set('origin', as === 'owner' ? publicOrigin : 'https://example.com')
		} else if (as === 'device') {
			headers.set('authorization', `Bearer ${signedIn.auth.devices.create('Shortcut').token}`)
		}

		const request = new Request(`${publicOrigin}/api/notes`, {
			method: 'PATCH',
			headers,
			body: JSON.stringify(body),
		})

		const withSession = as === 'owner' || as === 'another site'

		return sendThroughMiddleware(
			{ auth: signedIn.auth, publicOrigin },
			{ request, cookies: withSession ? signedIn.session : undefined },
			PATCH,
		)
	}

	it('archives notes and answers each in request order', async () => {
		const rows = noteRowFactory.transient({ db })
		const archivable = await rows.create({ status: 'ready' })
		const held = await rows.create({ status: 'researching' })
		const missing = held.id + 100

		const response = await send({
			body: { ids: [held.id, archivable.id, missing], status: 'archived' },
		})

		const answer = v.parse(bulkAnswer, await response.json())

		expect([response.status, answer.results]).toMatchObject([
			200,
			[
				{ id: held.id, outcome: 'conflict', note: { status: 'researching' } },
				{ id: archivable.id, outcome: 'changed', note: { status: 'archived' } },
				{ id: missing, outcome: 'not_found', note: null },
			],
		])
	})

	it('moves notes to a category with a device token', async () => {
		const category = await categoryRowFactory.transient({ db }).create()
		const { id } = await noteRowFactory.transient({ db }).create()

		const response = await send({ body: { ids: [id], categoryId: category.id }, as: 'device' })
		const answer = v.parse(bulkAnswer, await response.json())

		expect([response.status, answer.results]).toMatchObject([
			200,
			[{ id, outcome: 'changed', note: { categoryId: category.id } }],
		])
	})

	it.each([
		['nobody is signed in', 'nobody', 401],
		['the request comes from another site', 'another site', 403],
	] as const)('answers %s with %i and changes nothing', async (_case, as, status) => {
		const { id } = await noteRowFactory.transient({ db }).create()

		const response = await send({ body: { ids: [id], status: 'archived' }, as })
		const stored = db.select({ status: notes.status }).from(notes).where(eq(notes.id, id)).get()

		expect([response.status, stored]).toEqual([status, { status: 'new' }])
	})

	it('answers 415 without a JSON content type', async () => {
		const response = await send({
			body: { ids: [1], status: 'archived' },
			contentType: 'text/plain',
		})

		expect(response.status).toBe(415)
	})

	it.each<[string, BulkBody, string]>([
		['no ids', { ids: [], status: 'archived' }, 'ids: Name at least one note.'],
		[
			'101 ids',
			{ ids: Array.from({ length: 101 }, (_, index) => index + 1), status: 'archived' },
			'ids: Name at most 100 notes.',
		],
		[
			'both changes',
			{ ids: [1], status: 'archived', categoryId: 1 },
			'body: Change categoryId or status, not both.',
		],
		['no change', { ids: [1] }, 'body: Change categoryId or status, not both.'],
		[
			'a status other than archived',
			{ ids: [1], status: 'read' },
			'status: Invalid type: Expected "archived" but received "read"',
		],
		[
			'a category that does not exist',
			{ ids: [1], categoryId: 404 },
			'categoryId: There is no such category.',
		],
	])('answers 400 for %s', async (_case, body, issue) => {
		const response = await send({ body })

		expect([response.status, await response.json()]).toEqual([
			400,
			{
				error: {
					code: 'invalid_body',
					message: 'The body does not match what this route accepts.',
					issues: [issue],
				},
			},
		])
	})
})
