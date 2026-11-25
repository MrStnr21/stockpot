// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { afterEach, beforeEach, describe, expect, it, jest, mock, spyOn } from 'bun:test'
import { noteRowFactory } from '#tests/factories/notes'
import { sendThroughMiddleware, signedInInstance, type SignedInInstance } from '#tests/setup/auth'
import { createTestDb, type TestDb } from '#tests/setup/db'
import { storeCard } from '#tests/setup/deeper'
import { jobRows } from '#tests/setup/jobs'
import { eq } from 'drizzle-orm'

import { updateSettings } from '#/features/settings/server'
import { instanceDeeperJob, instanceResearchJob } from '#/instance'
import * as instance from '#/server/db/instance'
import { notes } from '#/server/db/schema/notes'
import * as jobsRunner from '#/server/jobs/runner'

import { POST } from './deeper'

const publicOrigin = 'http://127.0.0.1:4321'

// 19:00 in Tokyo, where the batch runs at 06:30 (the default time) the next morning.
const start = new Date('2026-11-21T10:00:00Z')

async function answer(response: Response): Promise<[number, unknown]> {
	return [response.status, await response.json()]
}

describe('POST /api/notes/:id/deeper', () => {
	let db: TestDb
	let signedIn: SignedInInstance
	let currentRunner: ReturnType<typeof spyOn<typeof jobsRunner, 'currentRunner'>>
	let noteId: number

	beforeEach(async () => {
		jest.useFakeTimers({ now: start })
		;({ db } = await createTestDb())
		signedIn = signedInInstance(db, publicOrigin)
		updateSettings(db, { digest: { timeZone: 'Asia/Tokyo' } })
		spyOn(instance, 'instanceDb').mockResolvedValue(db)

		// Not started, so a queued job stays in the table for the spec to read.
		currentRunner = spyOn(jobsRunner, 'currentRunner').mockReturnValue(
			jobsRunner.createRunner({
				db,
				jobs: [await instanceResearchJob(), await instanceDeeperJob()],
			}),
		)

		const note = await noteRowFactory.transient({ db }).create({ status: 'read' })

		noteId = note.id
		await storeCard(db, { noteId, depth: 1 })
	})

	afterEach(() => {
		mock.restore()
		jest.useRealTimers()
	})

	async function send(
		sent: {
			id?: string | number
			as?: 'owner' | 'device' | 'nobody'
			body?: unknown
			contentType?: string | null
		} = {},
	) {
		const { id = noteId, as = 'owner', body = {}, contentType = 'application/json' } = sent
		const headers = new Headers()

		if (contentType !== null) {
			headers.set('content-type', contentType)
		}

		if (as === 'owner') {
			headers.set('origin', publicOrigin)
		} else if (as === 'device') {
			headers.set('authorization', `Bearer ${signedIn.auth.devices.create('Shortcut').token}`)
		}

		const request = new Request(`${publicOrigin}/api/notes/${id}/deeper`, {
			method: 'POST',
			headers,
			body: JSON.stringify(body),
		})

		return sendThroughMiddleware(
			{ auth: signedIn.auth, publicOrigin },
			{
				request,
				cookies: as === 'owner' ? signedIn.session : undefined,
				params: { id: String(id) },
			},
			POST,
		)
	}

	function deeperRows() {
		return jobRows(db).filter(({ kind }) => kind === 'deeper')
	}

	it('queues level 2 for the next nightly batch with {} and answers 202', async () => {
		const response = await send()

		expect(await answer(response)).toEqual([202, { id: noteId, outcome: 'queued', depth: 2 }])
		expect(deeperRows()).toMatchObject([
			{ status: 'queued', priority: 0, payload: { noteId, depth: 2 } },
		])
		expect(deeperRows()[0]?.payload).toEqual({ noteId, depth: 2 })
		expect(deeperRows()[0]?.runAt).toEqual(new Date('2026-11-21T21:30:00Z'))
	})

	it('queues it at the now priority, due at once, for { now: true }', async () => {
		const response = await send({ body: { now: true } })

		expect(response.status).toBe(202)
		expect(deeperRows()).toMatchObject([
			{ priority: 10, payload: { noteId, depth: 2, now: true }, runAt: start },
		])
	})

	it('answers 200 pending and adds no job for a second identical request', async () => {
		await send()

		const response = await send()

		expect(await answer(response)).toEqual([200, { id: noteId, outcome: 'pending', depth: 2 }])
		expect(deeperRows()).toHaveLength(1)
	})

	it('answers 200 deepest and queues nothing once level 3 is written', async () => {
		await storeCard(db, { noteId, depth: 2 })
		await storeCard(db, { noteId, depth: 3 })

		const response = await send()

		expect(await answer(response)).toEqual([200, { id: noteId, outcome: 'deepest', depth: 3 }])
		expect(deeperRows()).toEqual([])
	})

	it('takes a device token too', async () => {
		const response = await send({ as: 'device' })

		expect(response.status).toBe(202)
	})

	it('answers 401 when nobody is signed in', async () => {
		const response = await send({ as: 'nobody' })

		expect(response.status).toBe(401)
		expect(deeperRows()).toEqual([])
	})

	it('answers 404 for a missing note and for a deleted one, queueing nothing', async () => {
		db.update(notes).set({ deletedAt: new Date() }).where(eq(notes.id, noteId)).run()

		const deleted = await send()
		const missing = await send({ id: noteId + 100 })

		expect(await answer(missing)).toEqual([
			404,
			{ error: { code: 'not_found', message: 'There is no such note.' } },
		])
		expect(deleted.status).toBe(404)
		expect(deeperRows()).toEqual([])
	})

	it('answers 409 no_card for a note without a first card', async () => {
		const bare = await noteRowFactory.transient({ db }).create()

		const response = await send({ id: bare.id })

		expect(await answer(response)).toEqual([
			409,
			{ error: { code: 'no_card', message: 'The note has no card to go deeper from yet.' } },
		])
		expect(deeperRows()).toEqual([])
	})

	it.each(['abc', '0', '-1', '1.5'])('answers 400 invalid_id for %s', async (id) => {
		const response = await send({ id })

		expect(await answer(response)).toMatchObject([400, { error: { code: 'invalid_id' } }])
	})

	it.each([{ now: 'yes' }, { depth: 3 }])('answers 400 invalid_body for %j', async (body) => {
		const response = await send({ body })

		expect(await answer(response)).toMatchObject([400, { error: { code: 'invalid_body' } }])
		expect(deeperRows()).toEqual([])
	})

	it('answers 415 without a JSON content type', async () => {
		const response = await send({ contentType: null })

		expect(response.status).toBe(415)
		expect(deeperRows()).toEqual([])
	})

	it('answers 503 and writes nothing when no job runner runs', async () => {
		currentRunner.mockReset()

		const response = await send()

		expect(await answer(response)).toMatchObject([503, { error: { code: 'jobs_unavailable' } }])
		expect(deeperRows()).toEqual([])
	})
})
