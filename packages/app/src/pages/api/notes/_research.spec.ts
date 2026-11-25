// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test'
import { explanationRowFactory } from '#tests/factories/explanations'
import { noteRowFactory } from '#tests/factories/notes'
import { sendThroughMiddleware, signedInInstance, type SignedInInstance } from '#tests/setup/auth'
import { createTestDb, type TestDb } from '#tests/setup/db'
import { jobRows } from '#tests/setup/jobs'

import { instanceResearchJob } from '#/instance'
import * as instance from '#/server/db/instance'
import * as jobsRunner from '#/server/jobs/runner'

import { POST } from './research'

const publicOrigin = 'http://127.0.0.1:4321'

describe('POST /api/notes/research', () => {
	let db: TestDb
	let signedIn: SignedInInstance
	let currentRunner: ReturnType<typeof spyOn<typeof jobsRunner, 'currentRunner'>>

	beforeEach(async () => {
		;({ db } = await createTestDb())
		signedIn = signedInInstance(db, publicOrigin)
		spyOn(instance, 'instanceDb').mockResolvedValue(db)

		// Not started, so a queued job stays in the table for the spec to read.
		currentRunner = spyOn(jobsRunner, 'currentRunner').mockReturnValue(
			jobsRunner.createRunner({ db, jobs: [await instanceResearchJob()] }),
		)
	})

	afterEach(() => {
		mock.restore()
	})

	interface Sent {
		readonly body?: unknown
		readonly contentType?: string
		readonly as?: 'owner' | 'device' | 'nobody'
	}

	async function send({ body, contentType = 'application/json', as = 'owner' }: Sent) {
		const headers = new Headers({ 'content-type': contentType })

		if (as === 'owner') {
			headers.set('origin', publicOrigin)
		} else if (as === 'device') {
			headers.set('authorization', `Bearer ${signedIn.auth.devices.create('Shortcut').token}`)
		}

		const request = new Request(`${publicOrigin}/api/notes/research`, {
			method: 'POST',
			headers,
			body: JSON.stringify(body),
		})

		return sendThroughMiddleware(
			{ auth: signedIn.auth, publicOrigin },
			{ request, cookies: as === 'owner' ? signedIn.session : undefined },
			POST,
		)
	}

	function researchRows() {
		return jobRows(db).filter(({ kind }) => kind === 'research')
	}

	it('answers each note in request order and queues only the ones that need it', async () => {
		const [fresh, finished, later] = await noteRowFactory.transient({ db }).createList(3)
		await explanationRowFactory.transient({ db }).create({ noteId: finished.id })
		const missing = later.id + 100

		const response = await send({
			body: { ids: [fresh.id, finished.id, missing, fresh.id, later.id] },
		})

		expect([response.status, await response.json()]).toEqual([
			200,
			{
				results: [
					{ id: fresh.id, outcome: 'queued' },
					{ id: finished.id, outcome: 'done' },
					{ id: missing, outcome: 'not_found' },
					{ id: later.id, outcome: 'queued' },
				],
			},
		])
		expect(researchRows()).toMatchObject([
			{ priority: 10, payload: { noteId: fresh.id, now: true } },
			{ priority: 10, payload: { noteId: later.id, now: true } },
		])
	})

	it('takes a device token too', async () => {
		const { id } = await noteRowFactory.transient({ db }).create()

		const response = await send({ body: { ids: [id] }, as: 'device' })

		expect([response.status, await response.json()]).toEqual([
			200,
			{ results: [{ id, outcome: 'queued' }] },
		])
	})

	it('answers 401 when nobody is signed in', async () => {
		const response = await send({ body: { ids: [1] }, as: 'nobody' })

		expect(response.status).toBe(401)
	})

	it('answers 400 invalid_body for no ids and for 101 ids, and queues nothing', async () => {
		const tooMany = Array.from({ length: 101 }, (_, index) => index + 1)

		const responses = await Promise.all([[], tooMany].map(async (ids) => send({ body: { ids } })))

		expect(responses.map(({ status }) => status)).toEqual([400, 400])

		expect(researchRows()).toEqual([])
	})

	it('answers 415 without a JSON content type', async () => {
		const response = await send({ body: { ids: [1] }, contentType: 'text/plain' })

		expect(response.status).toBe(415)
	})

	it('answers 503 and writes nothing when no job runner runs', async () => {
		const { id } = await noteRowFactory.transient({ db }).create()

		currentRunner.mockReset()

		const response = await send({ body: { ids: [id] } })

		expect([response.status, await response.json()]).toMatchObject([
			503,
			{ error: { code: 'jobs_unavailable' } },
		])
		expect(researchRows()).toEqual([])
	})
})
