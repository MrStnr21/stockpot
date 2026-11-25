// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test'
import { noteRowFactory } from '#tests/factories/notes'
import { sendThroughMiddleware, signedInInstance, type SignedInInstance } from '#tests/setup/auth'
import { createTestDb, type TestDb } from '#tests/setup/db'
import { eq } from 'drizzle-orm'

import { instanceProgressBoard } from '#/instance'
import * as instance from '#/server/db/instance'
import { notes } from '#/server/db/schema/notes'

import { GET } from './research'

const publicOrigin = 'http://127.0.0.1:4321'

const progress = { step: 'searching', questions: 5, searched: 2, pages: 11 } as const

describe('GET /api/notes/:id/research', () => {
	let db: TestDb
	let signedIn: SignedInInstance
	let noteId: number

	beforeEach(async () => {
		;({ db } = await createTestDb())
		signedIn = signedInInstance(db, publicOrigin)
		spyOn(instance, 'instanceDb').mockResolvedValue(db)

		const note = await noteRowFactory.transient({ db }).create()

		noteId = note.id
	})

	afterEach(() => {
		instanceProgressBoard.clear(noteId)
		mock.restore()
	})

	async function send(sent: { id?: string | number; as?: 'owner' | 'device' | 'nobody' } = {}) {
		const { id = noteId, as = 'owner' } = sent
		const headers = new Headers()

		if (as === 'device') {
			headers.set('authorization', `Bearer ${signedIn.auth.devices.create('Shortcut').token}`)
		}

		const request = new Request(`${publicOrigin}/api/notes/${id}/research`, { headers })

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

	it('answers 200 with no progress for a note that is not being researched', async () => {
		const response = await send()

		expect([response.status, await response.json()]).toEqual([
			200,
			{ id: noteId, status: 'new', progress: null },
		])
	})

	it("answers 200 with the board's progress while one is set", async () => {
		db.update(notes).set({ status: 'researching' }).where(eq(notes.id, noteId)).run()
		instanceProgressBoard.set(noteId, progress)

		const response = await send()

		expect([response.status, await response.json()]).toEqual([
			200,
			{ id: noteId, status: 'researching', progress },
		])
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
