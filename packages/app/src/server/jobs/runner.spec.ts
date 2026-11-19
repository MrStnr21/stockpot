// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { $ } from 'bun'
import type { Database } from 'bun:sqlite'
import { afterEach, beforeEach, describe, expect, it, jest, mock, spyOn, type Mock } from 'bun:test'
import { join } from 'node:path'
import { jobRowFactory } from '#tests/factories/jobs'
import { createTestDb, migrationsFolder, type TestDb } from '#tests/setup/db'
import { advanceBy, advanceTo, jobRows, succeedingHandler, type Handler } from '#tests/setup/jobs'

import { openDatabase } from '#/server/db/client'

import { createRunner } from './runner'
import type { JobDefinition, Runner } from './types'

describe('createRunner', () => {
	afterEach(() => {
		jest.useRealTimers()
	})

	describe('with a job queued before a restart', () => {
		let directory: string
		let sqlite: Database
		let run: Handler<{ noteId: number }>

		beforeEach(async () => {
			jest.useFakeTimers({ now: new Date('2026-11-18T12:00:00Z') })

			const created = await $`mktemp -d`.text()

			directory = created.trim()

			const path = join(directory, 'stockpot.db')
			const before = await openDatabase({ path, migrationsFolder })

			run = succeedingHandler()

			const research: JobDefinition<{ noteId: number }> = { kind: 'research', run }

			createRunner({ db: before.db, jobs: [research] }).enqueue(research, { noteId: 7 })
			before.sqlite.close()

			const after = await openDatabase({ path, migrationsFolder })

			const runner = createRunner({ db: after.db, jobs: [research] })

			;({ sqlite } = after)
			runner.start()
			await advanceBy(runner, 0)
			await runner.stop()
		})

		afterEach(async () => {
			sqlite.close()
			await $`rm -rf ${directory}`
		})

		it('runs the job once the database is opened again', () => {
			expect(run).toHaveBeenCalledWith({ noteId: 7 }, expect.objectContaining({ attempt: 1 }))
		})
	})

	describe('with batch jobs queued', () => {
		let order: string[]

		beforeEach(async () => {
			jest.useFakeTimers({ now: new Date('2026-11-18T12:00:00Z') })
			order = []

			const { db } = await createTestDb()

			const research: JobDefinition<{ name: string }> = {
				kind: 'research',
				run: async ({ name }) => {
					order.push(name)

					if (name === 'batch 1') {
						runner.enqueue(research, { name: 'now' }, { priority: 'now' })
					}
				},
			}

			const runner = createRunner({ db, jobs: [research] })

			for (const name of ['batch 1', 'batch 2', 'batch 3']) {
				runner.enqueue(research, { name })
			}

			runner.start()
			await advanceBy(runner, 0)
		})

		it('runs a "now" job before the batch jobs queued ahead of it', () => {
			expect(order).toEqual(['batch 1', 'now', 'batch 2', 'batch 3'])
		})
	})

	describe('when a handler keeps failing', () => {
		let db: TestDb
		let runner: Runner
		let run: Handler<object>

		beforeEach(async () => {
			jest.useFakeTimers({ now: new Date('2026-11-18T12:00:00Z') })
			;({ db } = await createTestDb())
			run = mock(async () => {
				throw new Error('The engine timed out')
			})

			const research: JobDefinition<object> = { kind: 'research', maxAttempts: 3, run }

			runner = createRunner({ db, jobs: [research] })
			runner.enqueue(research, {})
			runner.start()
			await advanceBy(runner, 0)
		})

		afterEach(async () => {
			await runner.stop()
		})

		it('queues the job again in 30 seconds with the error', () => {
			expect(jobRows(db)).toMatchObject([
				{
					status: 'queued',
					attempts: 1,
					lastError: 'The engine timed out',
					runAt: new Date('2026-11-18T12:00:30Z'),
				},
			])
		})

		it('runs it again when the delay is over, not before', async () => {
			await advanceBy(runner, 29_999)
			expect(run).toHaveBeenCalledTimes(1)
			await advanceBy(runner, 1)
			expect(run).toHaveBeenCalledTimes(2)
		})

		it('doubles the delay and marks the job failed after its last attempt', async () => {
			// Bun's fake clock can move a millisecond while the handler settles, so step past each retry.
			await advanceTo(runner, '2026-11-18T12:00:31Z')
			await advanceTo(runner, '2026-11-18T12:01:32Z')

			expect(run).toHaveBeenCalledTimes(3)
			expect(jobRows(db)).toMatchObject([
				{ status: 'failed', attempts: 3, lastError: 'The engine timed out' },
			])
		})
	})

	describe('when the database refuses writes', () => {
		let sqlite: Database
		let runner: Runner
		let run: Handler<object>
		let logged: Mock<typeof console.error>

		beforeEach(async () => {
			jest.useFakeTimers({ now: new Date('2026-11-18T12:00:00Z') })
			logged = spyOn(console, 'error').mockImplementation(() => {
				// Keeps the expected error out of the spec output.
			})

			run = succeedingHandler()

			const research: JobDefinition<object> = { kind: 'research', run }

			const opened = await createTestDb()

			;({ sqlite } = opened)
			runner = createRunner({ db: opened.db, jobs: [research] })
			runner.enqueue(research, {}, { runAt: new Date('2026-11-18T12:01:00Z') })
			runner.start()
			sqlite.run('PRAGMA query_only = 1')
			await advanceTo(runner, '2026-11-18T12:01:00Z')
		})

		afterEach(async () => {
			logged.mockRestore()
			await runner.stop()
			sqlite.close()
		})

		it('logs the error once and waits 30 seconds instead of looping', async () => {
			await advanceBy(runner, 29_999)

			expect(logged).toHaveBeenCalledTimes(1)
			expect(run).not.toHaveBeenCalled()

			const health = runner.health()

			expect(health).toMatchObject({
				status: 'failing',
				failedAt: new Date('2026-11-18T12:01:00Z'),
			})
			expect('lastError' in health ? health.lastError : '').toContain('readonly database')
		})

		it('runs the job and reports healthy once writes work again', async () => {
			sqlite.run('PRAGMA query_only = 0')
			await advanceBy(runner, 30_000)

			expect(run).toHaveBeenCalledTimes(1)
			expect(runner.health()).toEqual({ status: 'healthy' })
		})
	})

	describe('with jobs left running when the process stopped', () => {
		let db: TestDb
		let run: Handler<object>

		beforeEach(async () => {
			jest.useFakeTimers({ now: new Date('2026-11-18T12:00:00Z') })
			;({ db } = await createTestDb())
			run = succeedingHandler()

			const research: JobDefinition<object> = { kind: 'research', maxAttempts: 2, run }

			const running = jobRowFactory
				.transient({ db })
				.params({ kind: 'research', status: 'running' })

			await running.create({ attempts: 1 })
			await running.create({ attempts: 2 })

			const runner = createRunner({ db, jobs: [research] })

			runner.start()
			await advanceBy(runner, 0)
		})

		it('runs an interrupted job again', () => {
			expect(run).toHaveBeenCalledTimes(1)
			expect(jobRows(db)[0]).toMatchObject({ status: 'done', attempts: 2 })
		})

		it('fails an interrupted job that has no attempts left without running it', () => {
			expect(jobRows(db)[1]).toMatchObject({
				status: 'failed',
				lastError: 'Interrupted: the server stopped while the job was running',
			})
		})
	})
})
