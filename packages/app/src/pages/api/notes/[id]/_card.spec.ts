// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test'
import { storedBody } from '#tests/factories/card-bodies'
import { explanationRowFactory } from '#tests/factories/explanations'
import { noteRowFactory } from '#tests/factories/notes'
import { sendThroughMiddleware, signedInInstance, type SignedInInstance } from '#tests/setup/auth'
import { createTestDb, type TestDb } from '#tests/setup/db'
import { eq } from 'drizzle-orm'
import * as v from 'valibot'

import { cardViewSchema } from '#/features/research/shared/card-view'
import * as instance from '#/server/db/instance'
import { explanations } from '#/server/db/schema/explanations'
import { notes } from '#/server/db/schema/notes'

import { GET } from './card'

const publicOrigin = 'http://127.0.0.1:4321'

describe('GET /api/notes/:id/card', () => {
	let db: TestDb
	let signedIn: SignedInInstance
	let noteId: number

	beforeEach(async () => {
		;({ db } = await createTestDb())
		signedIn = signedInInstance(db, publicOrigin)
		spyOn(instance, 'instanceDb').mockResolvedValue(db)

		const note = await noteRowFactory.transient({ db }).create({ status: 'ready' })

		noteId = note.id
		// Inserted by hand: the row factory would merge its own sample body into this one.
		db.insert(explanations)
			.values({
				...explanationRowFactory.build(),
				noteId,
				format: 'brief',
				body: storedBody('brief', 1),
				sources: [{ title: 'A page', url: 'https://example.com/page' }],
			})
			.run()
	})

	afterEach(() => {
		mock.restore()
	})

	async function send(sent: { id?: string | number; as?: 'owner' | 'device' | 'nobody' } = {}) {
		const { id = noteId, as = 'owner' } = sent
		const headers = new Headers()

		if (as === 'device') {
			headers.set('authorization', `Bearer ${signedIn.auth.devices.create('Shortcut').token}`)
		}

		const request = new Request(`${publicOrigin}/api/notes/${id}/card`, { headers })

		return sendThroughMiddleware(
			{ auth: signedIn.auth, publicOrigin },
			{
				request,
				cookies: as === 'owner' ? signedIn.session : undefined,
				params: { id: String(id) },
			},
			GET,
		)
	}

	it('answers 200 with the card view in the shared shape', async () => {
		const response = await send()
		const view = v.parse(cardViewSchema, await response.json())

		expect(response.status).toBe(200)
		expect(view).toMatchObject({ note: { id: noteId, status: 'ready' }, format: 'brief' })
		expect(view.levels[0].card).toMatchObject({
			blocks: [{ kind: 'text', heading: 'explanation' }],
			sources: [{ title: 'A page', url: 'https://example.com/page' }],
		})
	})

	it('takes a device token too', async () => {
		const response = await send({ as: 'device' })

		expect(response.status).toBe(200)
	})

	it('answers 401 when nobody is signed in', async () => {
		const response = await send({ as: 'nobody' })

		expect(response.status).toBe(401)
	})

	it('answers 404 for a missing note', async () => {
		const response = await send({ id: noteId + 100 })

		expect([response.status, await response.json()]).toEqual([
			404,
			{ error: { code: 'not_found', message: 'There is no such note.' } },
		])
	})

	it('answers 404 for a deleted note', async () => {
		db.update(notes).set({ deletedAt: new Date() }).where(eq(notes.id, noteId)).run()

		const response = await send()

		expect(response.status).toBe(404)
	})

	it.each(['abc', '0', '1.5'])('answers 400 invalid_id for %s', async (id) => {
		const response = await send({ id })

		expect([response.status, await response.json()]).toMatchObject([
			400,
			{ error: { code: 'invalid_id' } },
		])
	})
})
