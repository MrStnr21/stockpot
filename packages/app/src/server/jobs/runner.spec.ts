// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { $ } from 'bun'
import type { Database } from 'bun:sqlite'
import { afterEach, beforeEach, describe, expect, it, jest } from 'bun:test'
import { join } from 'node:path'
import { createTestDb, migrationsFolder, type TestDb } from '#tests/setup/db'
import { advanceBy, jobRows, succeedingHandler, type Handler } from '#tests/setup/jobs'

import { openDatabase } from '#/server/db/client'

import type { JobRow } from './queue'
import { createRunner, startRunner, stopRunner } from './runner'
import type { JobDefinition, Runner } from './types'

describe('runner', () => {
	afterEach(() => {
		jest.useRealTimers()
	})

	describe('with a job queued before a restart', () => {
		let directory: string
		let sqlite: Database
		let db: TestDb
		let rowsBeforeStart: JobRow[]
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

			;({ sqlite, db } = after)
			rowsBeforeStart = jobRows(db)
			runner.start()
			await advanceBy(runner, 0)
			await runner.stop()
		})

		afterEach(async () => {
			sqlite.close()
			await $`rm -rf ${directory}`
		})

		it('finds the job queued in the reopened file and runs it', () => {
			expect(rowsBeforeStart).toMatchObject([{ status: 'queued', payload: { noteId: 7 } }])
			expect(run).toHaveBeenCalledWith({ noteId: 7 }, expect.objectContaining({ attempt: 1 }))
			expect(jobRows(db)).toMatchObject([{ status: 'done', attempts: 1 }])
		})
	})
	describe('with batch jobs queued', () => {
		let sqlite: Database
		let runner: Runner
		let order: string[]

		beforeEach(async () => {
			jest.useFakeTimers({ now: new Date('2026-11-18T12:00:00Z') })
			order = []

			const opened = await createTestDb()

			const { db } = opened

			;({ sqlite } = opened)

			const research: JobDefinition<{ name: string }> = {
				kind: 'research',
				run: async ({ name }) => {
					order.push(name)

					if (name === 'batch 1') {
						runner.enqueue(research, { name: 'now' }, { priority: 'now' })
					}
				},
			}

			runner = createRunner({ db, jobs: [research] })

			for (const name of ['batch 1', 'batch 2', 'batch 3']) {
				runner.enqueue(research, { name })
			}

			runner.start()
			await advanceBy(runner, 0)
		})

		afterEach(async () => {
			await runner.stop()
			sqlite.close()
		})

		it('runs a "now" job before the batch jobs queued ahead of it', () => {
			expect(order).toEqual(['batch 1', 'now', 'batch 2', 'batch 3'])
		})
	})
	describe('with a stopRunner that is not awaited before startRunner', () => {
		let sqlite: Database
		let calls: number
		let mostAtOnce: number

		beforeEach(async () => {
			jest.useFakeTimers({ now: new Date('2026-11-18T12:00:00Z') })
			calls = 0
			mostAtOnce = 0

			const opened = await createTestDb()

			const { promise: released, resolve: release } = Promise.withResolvers<boolean>()

			const inHand = { count: 0 }

			const research: JobDefinition<object> = {
				kind: 'research',
				run: async () => {
					calls += 1
					inHand.count += 1
					mostAtOnce = Math.max(mostAtOnce, inHand.count)
					await released
					inHand.count -= 1
				},
			}

			;({ sqlite } = opened)

			const first = await startRunner({ db: opened.db, jobs: [research] })

			first.enqueue(research, {})
			jest.advanceTimersByTime(0)

			const stopping = stopRunner()
			const starting = startRunner({ db: opened.db, jobs: [research] })

			release(true)
			await stopping

			const second = await starting

			await advanceBy(second, 0)
		})

		afterEach(async () => {
			await stopRunner()
			sqlite.close()
		})

		it('never runs the same row twice at once', () => {
			expect(calls).toBe(1)
			expect(mostAtOnce).toBe(1)
		})
	})
})
