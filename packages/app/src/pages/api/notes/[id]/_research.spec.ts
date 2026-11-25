// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test'
import { explanationRowFactory } from '#tests/factories/explanations'
import { noteRowFactory } from '#tests/factories/notes'
import { sendThroughMiddleware, signedInInstance, type SignedInInstance } from '#tests/setup/auth'
import { createTestDb, type TestDb } from '#tests/setup/db'
import { jobRows } from '#tests/setup/jobs'
import { eq } from 'drizzle-orm'

import { instanceResearchJob } from '#/instance'
import * as instance from '#/server/db/instance'
import { notes } from '#/server/db/schema/notes'
import * as jobsRunner from '#/server/jobs/runner'

import { POST } from './research'

const publicOrigin = 'http://127.0.0.1:4321'

describe('POST /api/notes/:id/research', () => {
	let db: TestDb
	let signedIn: SignedInInstance
	let currentRunner: ReturnType<typeof spyOn<typeof jobsRunner, 'currentRunner'>>
	let noteId: number

	beforeEach(async () => {
		;({ db } = await createTestDb())
		signedIn = signedInInstance(db, publicOrigin)
		spyOn(instance, 'instanceDb').mockResolvedValue(db)

		// Not started, so a queued job stays in the table for the spec to read.
		currentRunner = spyOn(jobsRunner, 'currentRunner').mockReturnValue(
			jobsRunner.createRunner({ db, jobs: [await instanceResearchJob()] }),
		)

		const note = await noteRowFactory.transient({ db }).create()

		noteId = note.id
	})

	afterEach(() => {
		mock.restore()
	})

	async function send(sent: { id?: string | number; as?: 'owner' | 'device' | 'nobody' } = {}) {
		const { id = noteId, as = 'owner' } = sent
		const headers = new Headers()

		if (as === 'owner') {
			headers.set('origin', publicOrigin)
		} else if (as === 'device') {
			headers.set('authorization', `Bearer ${signedIn.auth.devices.create('Shortcut').token}`)
		}

		const request = new Request(`${publicOrigin}/api/notes/${id}/research`, {
			method: 'POST',
			headers,
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

	function researchRows() {
		return jobRows(db).filter(({ kind }) => kind === 'research')
	}

	function statusOf(id: number) {
		return db.select({ status: notes.status }).from(notes).where(eq(notes.id, id)).get()?.status
	}

	it('queues the note at the now priority and answers 202', async () => {
		const response = await send()

		expect([response.status, await response.json()]).toEqual([
			202,
			{ id: noteId, outcome: 'queued' },
		])
		expect(researchRows()).toMatchObject([
			{ status: 'queued', priority: 10, payload: { noteId, now: true } },
		])
		expect(statusOf(noteId)).toBe('queued')
	})

	it('answers 200 pending and adds no job when the note has one already', async () => {
		await send()

		const response = await send()

		expect([response.status, await response.json()]).toEqual([
			200,
			{ id: noteId, outcome: 'pending' },
		])
		expect(researchRows()).toHaveLength(1)
	})

	it('queues one job when two requests for the same note are in flight together', async () => {
		const answers = await Promise.all([send(), send()])

		expect(answers.map(({ status }) => status).toSorted((a, b) => a - b)).toEqual([200, 202])
		expect(researchRows()).toHaveLength(1)
	})

	it('answers 200 done and queues nothing for a note with a finished card', async () => {
		await explanationRowFactory.transient({ db }).create({ noteId })

		const response = await send()

		expect([response.status, await response.json()]).toEqual([200, { id: noteId, outcome: 'done' }])
		expect(researchRows()).toEqual([])
	})

	it('takes a device token too', async () => {
		const response = await send({ as: 'device' })

		expect(response.status).toBe(202)
	})

	it('answers 401 when nobody is signed in', async () => {
		const response = await send({ as: 'nobody' })

		expect(response.status).toBe(401)
		expect(researchRows()).toEqual([])
	})

	it('answers 404 for a missing note', async () => {
		const response = await send({ id: noteId + 100 })

		expect([response.status, await response.json()]).toEqual([
			404,
			{ error: { code: 'not_found', message: 'There is no such note.' } },
		])
	})

	it('answers 404 for a deleted note and queues nothing', async () => {
		db.update(notes).set({ deletedAt: new Date() }).where(eq(notes.id, noteId)).run()

		const response = await send()

		expect(response.status).toBe(404)
		expect(researchRows()).toEqual([])
	})

	it.each(['abc', '0', '01', '-1', '1.5'])('answers 400 invalid_id for %s', async (id) => {
		const response = await send({ id })

		expect([response.status, await response.json()]).toMatchObject([
			400,
			{ error: { code: 'invalid_id' } },
		])
	})

	it('answers 503 and writes nothing when no job runner runs', async () => {
		currentRunner.mockReset()

		const response = await send()

		expect([response.status, await response.json()]).toMatchObject([
			503,
			{ error: { code: 'jobs_unavailable' } },
		])
		expect(researchRows()).toEqual([])
		expect(statusOf(noteId)).toBe('new')
	})
})
