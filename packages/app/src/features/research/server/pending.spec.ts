// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import type { Database } from 'bun:sqlite'
import { afterEach, beforeEach, describe, expect, it, jest } from 'bun:test'
import { jobRowFactory } from '#tests/factories/jobs'
import { noteRowFactory } from '#tests/factories/notes'
import { createTestDb, type TestDb } from '#tests/setup/db'

import { pendingResearchNoteIds } from './pending'

describe('pendingResearchNoteIds', () => {
	let sqlite: Database
	let db: TestDb

	beforeEach(async () => {
		jest.useFakeTimers({ now: new Date('2026-11-18T06:30:00Z') })
		;({ sqlite, db } = await createTestDb())
	})

	afterEach(() => {
		sqlite.close()
		jest.useRealTimers()
	})

	it('collects each note id once across queued and running research jobs', async () => {
		const [queued, running] = await noteRowFactory.transient({ db }).createList(2)
		const job = jobRowFactory.transient({ db }).params({ kind: 'research' })
		await job.create({ payload: { noteId: queued.id }, status: 'queued' })
		await job.create({ payload: { noteId: running.id }, status: 'running' })
		await job.create({ payload: { noteId: running.id }, status: 'queued' })

		expect(pendingResearchNoteIds(db)).toEqual(new Set([queued.id, running.id]))
	})

	it('ignores malformed payloads and keeps valid note ids', async () => {
		const { id } = await noteRowFactory.transient({ db }).create()
		const job = jobRowFactory.transient({ db }).params({ kind: 'research' })
		await job.create({ payload: [id] })
		await job.create({ payload: {} })
		await job.create({ payload: { noteId: String(id) } })
		await job.create({ payload: { noteId: id + 0.5 } })
		await job.create({ payload: { noteId: id } })

		expect(pendingResearchNoteIds(db)).toEqual(new Set([id]))
	})
})
