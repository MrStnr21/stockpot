// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { afterEach, beforeEach, describe, expect, it, jest, setSystemTime } from 'bun:test'
import { createTestDb, type TestDb } from '#tests/setup/db'
import { advanceBy, advanceTo, jobRows, succeedingHandler, type Handler } from '#tests/setup/jobs'

import { createRunner } from './runner'
import type { JobDefinition, Runner, ScheduledRun } from './types'

describe('daily schedules', () => {
	let db: TestDb
	let run: Handler<ScheduledRun>
	let digest: JobDefinition<ScheduledRun>
	let timeZone: string
	let at: string

	/** A runner with one schedule; a second call stands for the server after a restart. */
	function startRunner() {
		const runner = createRunner({ db, schedules: [{ job: digest, at }], timeZone: () => timeZone })

		runner.start()

		return runner
	}

	beforeEach(async () => {
		;({ db } = await createTestDb())
		run = succeedingHandler()
		digest = { kind: 'digest', run }
	})

	afterEach(() => {
		jest.useRealTimers()
	})

	describe('at 07:00 in Tokyo', () => {
		let runner: Runner

		beforeEach(() => {
			jest.useFakeTimers({ now: new Date('2026-11-18T12:00:00Z') })
			timeZone = 'Asia/Tokyo'
			at = '07:00'
			runner = startRunner()
		})

		afterEach(async () => {
			await runner.stop()
		})

		it('fires at 07:00 local time with that day, not before', async () => {
			await advanceTo(runner, '2026-11-18T21:59:59.999Z')
			expect(run).not.toHaveBeenCalled()
			await advanceBy(runner, 1)
			expect(run).toHaveBeenCalledWith({ day: '2026-11-19' }, expect.anything())
		})

		it("plans the next day's run when it fires", async () => {
			await advanceTo(runner, '2026-11-18T22:00:00Z')

			expect(jobRows(db)).toMatchObject([
				{ status: 'done', payload: { day: '2026-11-19' } },
				{
					status: 'queued',
					payload: { day: '2026-11-20' },
					runAt: new Date('2026-11-19T22:00:00Z'),
				},
			])
		})

		it('moves the planned run when the time zone changes', () => {
			timeZone = 'Europe/Paris'
			runner.refreshSchedules()

			expect(jobRows(db)).toMatchObject([
				{ payload: { day: '2026-11-19' }, runAt: new Date('2026-11-19T06:00:00Z') },
			])
		})
	})

	describe('on the day the clocks go forward in Berlin', () => {
		let runner: Runner

		beforeEach(() => {
			jest.useFakeTimers({ now: new Date('2026-03-28T12:00:00Z') })
			timeZone = 'Europe/Berlin'
			at = '02:30'
			runner = startRunner()
		})

		afterEach(async () => {
			await runner.stop()
		})

		it('fires the skipped 02:30 an hour later, at 03:30 summer time', async () => {
			await advanceTo(runner, '2026-03-29T01:29:59.999Z')
			expect(run).not.toHaveBeenCalled()
			await advanceBy(runner, 1)
			expect(run).toHaveBeenCalledWith({ day: '2026-03-29' }, expect.anything())
		})
	})

	describe('on the day the clocks go back in New York', () => {
		let runner: Runner

		beforeEach(() => {
			jest.useFakeTimers({ now: new Date('2026-10-31T12:00:00Z') })
			timeZone = 'America/New_York'
			at = '01:30'
			runner = startRunner()
		})

		afterEach(async () => {
			await runner.stop()
		})

		it('fires the repeated 01:30 once, at its first occurrence', async () => {
			await advanceTo(runner, '2026-11-01T05:30:00Z')
			await advanceTo(runner, '2026-11-01T06:30:00Z')
			await advanceTo(runner, '2026-11-01T07:00:00Z')

			expect(run).toHaveBeenCalledTimes(1)
			expect(jobRows(db)).toMatchObject([
				{ status: 'done', runAt: new Date('2026-11-01T05:30:00Z') },
				{ status: 'queued', runAt: new Date('2026-11-02T06:30:00Z') },
			])
		})
	})

	describe('after the server was down at the run time', () => {
		let runner: Runner

		beforeEach(async () => {
			jest.useFakeTimers({ now: new Date('2026-11-18T12:00:00Z') })
			timeZone = 'Asia/Tokyo'
			at = '07:00'
			await startRunner().stop()
			setSystemTime(new Date('2026-11-21T03:00:00Z'))
			runner = startRunner()
			await advanceBy(runner, 0)
		})

		afterEach(async () => {
			await runner.stop()
		})

		it('fires the latest missed run once, with its day', () => {
			expect(run).toHaveBeenCalledTimes(1)
			expect(run).toHaveBeenCalledWith({ day: '2026-11-21' }, expect.anything())
		})

		it('plans the next run for the next day', () => {
			expect(jobRows(db)).toMatchObject([
				{ status: 'done' },
				{
					status: 'queued',
					payload: { day: '2026-11-22' },
					runAt: new Date('2026-11-21T22:00:00Z'),
				},
			])
		})
	})

	describe("when the server restarts after the day's run", () => {
		let runner: Runner

		beforeEach(async () => {
			jest.useFakeTimers({ now: new Date('2026-11-18T12:00:00Z') })
			timeZone = 'Asia/Tokyo'
			at = '07:00'

			const first = startRunner()

			await advanceTo(first, '2026-11-18T22:00:00Z')
			await first.stop()
			setSystemTime(new Date('2026-11-18T23:00:00Z'))
			runner = startRunner()
			await advanceBy(runner, 0)
		})

		afterEach(async () => {
			await runner.stop()
		})

		it('does not fire again', () => {
			expect(run).toHaveBeenCalledTimes(1)
		})
	})
})
