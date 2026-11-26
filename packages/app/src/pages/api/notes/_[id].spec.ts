// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test'
import { noteRowFactory } from '#tests/factories/notes'
import {
	sendThroughMiddleware,
	signedInInstance,
	type RouteHandler,
	type SignedInInstance,
} from '#tests/setup/auth'
import { createTestDb, type TestDb } from '#tests/setup/db'
import { eq } from 'drizzle-orm'

import * as instance from '#/server/db/instance'
import { notes } from '#/server/db/schema/notes'

import { DELETE, PATCH } from './[id]'

const publicOrigin = 'http://127.0.0.1:4321'

/** The status a request is answered with. */
async function statusOf(answer: Promise<Response>) {
	const response = await answer

	return response.status
}

describe('/api/notes/:id', () => {
	let db: TestDb
	let signedIn: SignedInInstance
	let id: string

	beforeEach(async () => {
		;({ db } = await createTestDb())
		signedIn = signedInInstance(db, publicOrigin)
		spyOn(instance, 'instanceDb').mockResolvedValue(db)
		const note = await noteRowFactory.transient({ db }).create({ status: 'ready' })

		id = String(note.id)
	})

	afterEach(() => {
		mock.restore()
	})

	interface Sent {
		readonly noteId?: string
		readonly body?: unknown
		readonly as?: 'owner' | 'device' | 'nobody'
	}

	async function send(handler: RouteHandler, method: string, sent: Sent = {}) {
		const { noteId = id, body, as = 'owner' } = sent
		const headers = new Headers({ 'content-type': 'application/json' })

		if (as === 'owner') {
			headers.set('origin', publicOrigin)
		} else if (as === 'device') {
			headers.set('authorization', `Bearer ${signedIn.auth.devices.create('Shortcut').token}`)
		}

		const request = new Request(`${publicOrigin}/api/notes/${noteId}`, {
			method,
			headers,
			body: body === undefined ? null : JSON.stringify(body),
		})

		const cookies = as === 'owner' ? signedIn.session : undefined

		return sendThroughMiddleware(
			{ auth: signedIn.auth, publicOrigin },
			{ request, cookies, params: { id: noteId } },
			handler,
		)
	}

	function keptAtOf() {
		return db
			.select({ keptAt: notes.keptAt })
			.from(notes)
			.where(eq(notes.id, Number(id)))
			.get()?.keptAt
	}

	async function patch(sent: Sent) {
		return send(PATCH, 'PATCH', sent)
	}

	async function remove(sent: Sent = {}) {
		return send(DELETE, 'DELETE', sent)
	}

	describe('PATCH', () => {
		it('marks a ready note read', async () => {
			const response = await patch({ body: { status: 'read' } })

			expect([response.status, await response.json()]).toMatchObject([
				200,
				{ id: Number(id), status: 'read' },
			])
		})

		it('takes a device token too', async () => {
			expect(await statusOf(patch({ body: { status: 'archived' }, as: 'device' }))).toBe(200)
		})

		it('answers 401 when nobody is signed in', async () => {
			expect(await statusOf(patch({ body: { status: 'read' }, as: 'nobody' }))).toBe(401)
		})

		it('answers 409 with a JSON error to a status the owner may not set', async () => {
			const response = await patch({ body: { status: 'queued' } })

			expect([response.status, await response.json()]).toEqual([
				409,
				{
					error: {
						code: 'status_conflict',
						message: 'A note with status ready cannot be set to queued.',
					},
				},
			])
		})

		it.each([
			['an empty change', {}, 'body: Change categoryId, status, deleted or kept.'],
			['kept: "yes"', { kept: 'yes' }, 'kept: Invalid type: Expected boolean but received "yes"'],
			[
				'deleted: true',
				{ deleted: true },
				'deleted: Send false to restore a note; delete it with DELETE.',
			],
		])('answers 400 to %s', async (_case, body, issue) => {
			const response = await patch({ body })

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

		it('keeps a note in Base and takes it out again', async () => {
			const kept = await patch({ body: { kept: true } })
			const keptAt = keptAtOf()
			const again = await patch({ body: { kept: true } })

			expect(keptAt).toBeInstanceOf(Date)
			expect([kept.status, again.status, keptAtOf()]).toEqual([200, 200, keptAt])
			expect([await statusOf(patch({ body: { kept: false } })), keptAtOf()]).toEqual([200, null])
		})

		it('answers 404 to keeping a deleted note and leaves it out of Base', async () => {
			expect(await statusOf(remove())).toBe(204)
			expect([await statusOf(patch({ body: { kept: true } })), keptAtOf()]).toEqual([404, null])
		})

		it('answers 400 to a status that does not exist', async () => {
			expect(await statusOf(patch({ body: { status: 'done' } }))).toBe(400)
		})

		it('answers 404 with a JSON error for a note that does not exist', async () => {
			const response = await patch({ noteId: '404', body: { status: 'read' } })

			expect([response.status, await response.json()]).toEqual([
				404,
				{ error: { code: 'not_found', message: 'There is no such note.' } },
			])
		})
	})

	describe('DELETE', () => {
		it('answers 204, and 404 to the deleted note from then on', async () => {
			const statuses = [
				await statusOf(remove()),
				await statusOf(remove()),
				await statusOf(patch({ body: { status: 'read' } })),
			]

			expect(statuses).toEqual([204, 404, 404])
		})

		it('lets the Undo toast restore the note with deleted: false', async () => {
			await remove()

			const response = await patch({ body: { deleted: false } })

			expect([response.status, await response.json()]).toMatchObject([
				200,
				{ id: Number(id), status: 'ready' },
			])
		})

		it('takes a device token too', async () => {
			expect(await statusOf(remove({ as: 'device' }))).toBe(204)
		})

		it('answers 401 when nobody is signed in', async () => {
			expect(await statusOf(remove({ as: 'nobody' }))).toBe(401)
		})

		it('answers 404 for a note that does not exist', async () => {
			expect(await statusOf(remove({ noteId: '404' }))).toBe(404)
		})
	})

	describe('with a malformed id', () => {
		it.each(['abc', '0', '01', '-1', '1.5'])('answers 400 to %s', async (noteId) => {
			const invalidId = {
				error: { code: 'invalid_id', message: 'A note id is a positive integer.' },
			}

			const patched = await patch({ noteId, body: { status: 'read' } })
			const removed = await remove({ noteId })

			expect([
				[patched.status, await patched.json()],
				[removed.status, await removed.json()],
			]).toEqual([
				[400, invalidId],
				[400, invalidId],
			])
		})
	})
})
