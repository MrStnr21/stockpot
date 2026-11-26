// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import type { Database } from 'bun:sqlite'
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { jobRowFactory } from '#tests/factories/jobs'
import { createTestDb, type TestDb } from '#tests/setup/db'

import { priorities } from '#/server/jobs/queue'

import { failureKind, noteJobs } from './card-jobs'

const now = new Date('2026-11-19T09:00:00Z')

function minutes(offset: number) {
	return new Date(now.getTime() + offset * 60_000)
}

describe('card jobs', () => {
	let sqlite: Database
	let db: TestDb
	let job: ReturnType<typeof jobRowFactory.transient>

	beforeEach(async () => {
		;({ sqlite, db } = await createTestDb())
		job = jobRowFactory.transient({ db })
	})

	afterEach(() => {
		sqlite.close()
	})

	describe('failureKind', () => {
		it.each(['timeout', 'invalid', 'auth', 'rate_limited', 'error'] as const)(
			'reads %s from the stored error',
			(kind) => {
				expect(failureKind(`The engine failed: ${kind}`)).toBe(kind)
			},
		)

		it.each([
			'Interrupted: the server stopped while the job was running',
			'The engine failed: unknown',
			null,
		])('reads %p as error', (lastError) => {
			expect(failureKind(lastError)).toBe('error')
		})
	})

	describe('noteJobs', () => {
		it('finds no job and no failure for a note without any', () => {
			expect(noteJobs(db, { id: 1, failed: false }, now)).toEqual({
				levels: [null, null, null],
				failure: null,
			})
		})

		it('puts a research job on level 1 and a deeper job on the level it names', async () => {
			const research = await job.create({
				kind: 'research',
				payload: { noteId: 1 },
				runAt: minutes(-5),
				createdAt: minutes(-6),
			})

			await job.create({
				kind: 'deeper',
				payload: { noteId: 1, depth: 3, now: true },
				priority: priorities.now,
				status: 'running',
			})

			expect(noteJobs(db, { id: 1, failed: false }, now).levels).toEqual([
				{
					state: 'queued',
					priority: 'batch',
					runAt: research.runAt.toISOString(),
					queuedAt: research.createdAt.toISOString(),
					ahead: 1,
				},
				null,
				expect.objectContaining({ state: 'researching', priority: 'now', ahead: 0 }),
			])
		})

		it('counts running jobs and the due queued jobs the worker takes first as ahead', async () => {
			await job.create({ kind: 'research', payload: { noteId: 2 }, status: 'running' })
			await job.create({
				kind: 'deeper',
				payload: { noteId: 3, depth: 2 },
				priority: 10,
				runAt: minutes(-9),
			})
			// Taken after the note's job: a lower priority, a later run time, a reset still to come.
			await job.create({ kind: 'research', payload: { noteId: 4 }, runAt: minutes(-20) })
			await job.create({
				kind: 'research',
				payload: { noteId: 5 },
				priority: 10,
				runAt: minutes(-1),
			})
			await job.create({
				kind: 'research',
				payload: { noteId: 6 },
				priority: 10,
				runAt: minutes(30),
			})
			// Not research work at all.
			await job.create({ kind: 'backup', status: 'running' })
			await job.create({
				kind: 'research',
				payload: { noteId: 1, now: true },
				priority: 10,
				runAt: minutes(-2),
			})

			expect(noteJobs(db, { id: 1, failed: false }, now).levels[0]).toMatchObject({
				state: 'queued',
				priority: 'now',
				ahead: 2,
			})
		})

		it('shows the run time of a job that waits for a limit to reset', async () => {
			await job.create({
				kind: 'research',
				payload: { noteId: 1 },
				priority: 10,
				runAt: minutes(45),
			})

			expect(noteJobs(db, { id: 1, failed: false }, now).levels[0]).toMatchObject({
				state: 'queued',
				runAt: minutes(45).toISOString(),
			})
		})

		it('shows the job the worker takes first when a level has two', async () => {
			await job.create({ kind: 'deeper', payload: { noteId: 1, depth: 2 }, runAt: minutes(600) })
			await job.create({
				kind: 'deeper',
				payload: { noteId: 1, depth: 2, now: true },
				priority: 10,
			})

			expect(noteJobs(db, { id: 1, failed: false }, now).levels[1]).toMatchObject({
				priority: 'now',
			})
		})

		it('skips a job whose payload does not parse', async () => {
			await job.create({ kind: 'research', payload: { noteId: 'one' } })
			await job.create({ kind: 'deeper', payload: { noteId: 1, depth: 4 } })

			expect(noteJobs(db, { id: 1, failed: false }, now).levels).toEqual([null, null, null])
		})

		it("reads the failure of a failed note's newest research job", async () => {
			const failed = { kind: 'research', status: 'failed', payload: { noteId: 1 } } as const

			await job.create({ ...failed, lastError: 'The engine failed: invalid' })
			await job.create({
				...failed,
				attempts: 3,
				lastError: 'The engine failed: timeout',
				finishedAt: minutes(-10),
			})
			// Newer, but another note's and another kind's.
			await job.create({ ...failed, payload: { noteId: 2 }, lastError: 'The engine failed: auth' })
			await job.create({ ...failed, kind: 'deeper', payload: { noteId: 1, depth: 2 } })

			expect(noteJobs(db, { id: 1, failed: true }, now).failure).toEqual({
				kind: 'timeout',
				attempts: 3,
				at: minutes(-10).toISOString(),
			})
			expect(noteJobs(db, { id: 1, failed: false }, now).failure).toBeNull()
		})

		it('shows no failure once a newer research job ended done, as a rejected key ends it', async () => {
			await job.create({
				kind: 'research',
				status: 'failed',
				payload: { noteId: 1 },
				lastError: 'The engine failed: timeout',
			})
			await job.create({ kind: 'research', status: 'done', payload: { noteId: 1 } })

			expect(noteJobs(db, { id: 1, failed: true }, now).failure).toBeNull()
		})

		it('shows no failure for a failed note without a research job', () => {
			expect(noteJobs(db, { id: 1, failed: true }, now).failure).toBeNull()
		})
	})
})
