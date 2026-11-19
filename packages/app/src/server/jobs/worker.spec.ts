// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import type { Database } from 'bun:sqlite'
import { afterEach, beforeEach, describe, expect, it, jest, mock, spyOn, type Mock } from 'bun:test'
import { jobRowFactory } from '#tests/factories/jobs'
import { createTestDb, type TestDb } from '#tests/setup/db'
import { advanceBy, advanceTo, jobRows, succeedingHandler, type Handler } from '#tests/setup/jobs'

import { createRunner } from './runner'
import type { JobDefinition, Runner } from './types'

describe('worker', () => {
	afterEach(() => {
		jest.useRealTimers()
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
	describe('when a handler never settles', () => {
		let sqlite: Database
		let db: TestDb
		let runner: Runner
		let signals: AbortSignal[]

		async function stopWithinTenSeconds() {
			const stopped = runner.stop()

			jest.advanceTimersByTime(10_000)
			await stopped
		}

		beforeEach(async () => {
			jest.useFakeTimers({ now: new Date('2026-11-18T12:00:00Z') })
			;({ sqlite, db } = await createTestDb())
			signals = []

			const research: JobDefinition<object> = {
				kind: 'research',
				timeout: 60_000,
				run: async (_payload, { signal }) => {
					signals.push(signal)
					await Promise.withResolvers<never>().promise
				},
			}

			runner = createRunner({ db, jobs: [research] })
			runner.enqueue(research, {})
			runner.start()
			jest.advanceTimersByTime(0)
		})

		afterEach(async () => {
			await stopWithinTenSeconds()
			sqlite.close()
		})

		it('fails the attempt when its timeout passes and queues the job again', async () => {
			await advanceBy(runner, 60_000)

			expect(signals[0]?.aborted).toBe(true)
			expect(jobRows(db)).toMatchObject([
				{ status: 'queued', attempts: 1, lastError: 'Timed out after 60 s' },
			])
		})

		it('stops within 10 seconds and leaves the job running for the next start', async () => {
			await stopWithinTenSeconds()

			expect(signals[0]?.aborted).toBe(true)
			expect(jobRows(db)).toMatchObject([{ status: 'running', attempts: 1 }])
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
