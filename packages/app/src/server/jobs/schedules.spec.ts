// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import type { Database } from 'bun:sqlite'
import {
	afterEach,
	beforeEach,
	describe,
	expect,
	it,
	jest,
	setSystemTime,
	spyOn,
	type Mock,
} from 'bun:test'
import { createTestDb, type TestDb } from '#tests/setup/db'
import { advanceBy, advanceTo, jobRows, succeedingHandler, type Handler } from '#tests/setup/jobs'

import { log, type Logger } from '#/server/log'

import { createRunner } from './runner'
import type { DailySchedule, JobDefinition, Runner, ScheduledRun } from './types'

describe('daily schedules', () => {
	let sqlite: Database
	let db: TestDb
	let run: Handler<ScheduledRun>
	let digest: JobDefinition<ScheduledRun>
	let timeZone: string
	let at: string
	let runner: Runner

	/** Starts a runner with one schedule; a second call stands for the server after a restart. */
	function startScheduled(scheduledAt: DailySchedule['at'] = at) {
		runner = createRunner({
			db,
			schedules: [{ job: digest, at: scheduledAt }],
			timeZone: () => timeZone,
		})
		runner.start()

		return runner
	}

	function firedDays() {
		return run.mock.calls.map(([payload]) => payload.day)
	}

	beforeEach(async () => {
		;({ sqlite, db } = await createTestDb())
		run = succeedingHandler()
		digest = { kind: 'digest', run }
	})

	afterEach(async () => {
		await runner.stop()
		sqlite.close()
		jest.useRealTimers()
	})

	describe('at 07:00 in Tokyo', () => {
		beforeEach(() => {
			jest.useFakeTimers({ now: new Date('2026-11-18T12:00:00Z') })
			timeZone = 'Asia/Tokyo'
			at = '07:00'
			startScheduled()
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

		it('keeps the day and moves its time when the time zone changes', () => {
			timeZone = 'Europe/Paris'
			runner.refreshSchedules()

			expect(jobRows(db)).toMatchObject([
				{ payload: { day: '2026-11-19' }, runAt: new Date('2026-11-19T06:00:00Z') },
			])
		})

		it('does not run 2026-11-19 again after a move to Paris at 23:00Z', async () => {
			await advanceTo(runner, '2026-11-18T23:00:00Z')
			timeZone = 'Europe/Paris'
			runner.refreshSchedules()
			await advanceTo(runner, '2026-11-20T06:00:00Z')

			expect(firedDays()).toEqual(['2026-11-19', '2026-11-20'])
		})

		it('does not run the day again when the time moves from 07:00 to 09:00 after its run', async () => {
			await advanceTo(runner, '2026-11-18T23:00:00Z')
			await runner.stop()
			at = '09:00'
			startScheduled()
			await advanceTo(runner, '2026-11-20T00:00:00Z')

			expect(firedDays()).toEqual(['2026-11-19', '2026-11-20'])
		})
	})

	describe('at 09:00 or 07:00, before the run', () => {
		beforeEach(() => {
			jest.useFakeTimers({ now: new Date('2026-11-18T12:00:00Z') })
		})

		it('does not skip 2026-11-19 after a move from Paris to Tokyo at 23:30Z', async () => {
			timeZone = 'Europe/Paris'
			at = '07:00'
			startScheduled()
			await advanceTo(runner, '2026-11-18T23:30:00Z')
			timeZone = 'Asia/Tokyo'
			runner.refreshSchedules()
			await advanceTo(runner, '2026-11-19T22:00:00Z')

			expect(firedDays()).toEqual(['2026-11-19', '2026-11-20'])
		})

		it('fires the day at once when the time moves from 09:00 to 07:00 after 07:00', async () => {
			timeZone = 'Asia/Tokyo'
			at = '09:00'
			startScheduled(() => at)
			await advanceTo(runner, '2026-11-18T23:00:00Z')
			at = '07:00'
			runner.refreshSchedules()
			await advanceBy(runner, 0)

			expect(firedDays()).toEqual(['2026-11-19'])
		})
	})

	describe('with a time getter', () => {
		beforeEach(() => {
			jest.useFakeTimers({ now: new Date('2026-11-18T06:00:00Z') })
			timeZone = 'UTC'
			at = '06:30'
			startScheduled(() => at)
		})

		it('uses the getter at start and moves the planned day on refresh', async () => {
			expect(jobRows(db)).toMatchObject([{ runAt: new Date('2026-11-18T06:30:00Z') }])

			at = '07:30'
			runner.refreshSchedules()

			expect(jobRows(db)).toMatchObject([
				{ payload: { day: '2026-11-18' }, runAt: new Date('2026-11-18T07:30:00Z') },
			])
			await advanceTo(runner, '2026-11-18T07:30:00Z')
			expect(firedDays()).toEqual(['2026-11-18'])
		})

		it('plans the following day at the current time when the queued run fires', async () => {
			at = '07:30'
			await advanceTo(runner, '2026-11-18T06:30:00Z')

			const nextRunAt = new Date('2026-11-19T07:30:00Z')

			expect(jobRows(db)).toMatchObject([
				{ status: 'done', payload: { day: '2026-11-18' } },
				{ status: 'queued', payload: { day: '2026-11-19' }, runAt: nextRunAt },
			])
		})
	})

	describe('on the day the clocks go forward in Berlin', () => {
		beforeEach(() => {
			jest.useFakeTimers({ now: new Date('2026-03-28T12:00:00Z') })
			timeZone = 'Europe/Berlin'
			at = '02:30'
			startScheduled()
		})

		it('fires the skipped 02:30 an hour later, at 03:30 summer time', async () => {
			await advanceTo(runner, '2026-03-29T01:29:59.999Z')
			expect(run).not.toHaveBeenCalled()
			await advanceBy(runner, 1)
			expect(run).toHaveBeenCalledWith({ day: '2026-03-29' }, expect.anything())
		})
	})

	describe('on the day the clocks go back in New York', () => {
		beforeEach(() => {
			jest.useFakeTimers({ now: new Date('2026-10-31T12:00:00Z') })
			timeZone = 'America/New_York'
			at = '01:30'
			startScheduled()
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
		beforeEach(async () => {
			jest.useFakeTimers({ now: new Date('2026-11-18T12:00:00Z') })
			timeZone = 'Asia/Tokyo'
			at = '07:00'
			await startScheduled().stop()
			setSystemTime(new Date('2026-11-21T03:00:00Z'))
			startScheduled()
			await advanceBy(runner, 0)
		})

		it('fires only the latest missed run, with its day', () => {
			expect(firedDays()).toEqual(['2026-11-21'])
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

	describe.each(['zone', 'time'])('with an invalid %s at run time', (setting) => {
		let logged: Mock<Logger['error']>

		beforeEach(async () => {
			jest.useFakeTimers({ now: new Date('2026-11-18T12:00:00Z') })
			logged = spyOn(log, 'error').mockImplementation(() => {
				// Keeps the expected error out of the spec output.
			})

			timeZone = 'Asia/Tokyo'
			at = '07:00'
			startScheduled(() => at)

			timeZone = setting === 'zone' ? 'Asia/Nowhere' : 'Asia/Tokyo'
			at = setting === 'time' ? '24:00' : '07:00'
			await advanceTo(runner, '2026-11-18T22:00:00Z')
		})

		afterEach(() => {
			logged.mockRestore()
		})

		it('leaves the run queued and planned, without running it', () => {
			expect(run).not.toHaveBeenCalled()
			expect(jobRows(db)).toMatchObject([{ status: 'queued', attempts: 0 }])
			expect(runner.health()).toMatchObject({ status: 'failing' })
		})

		it('fires the run once the setting is valid again', async () => {
			timeZone = 'Asia/Tokyo'
			at = '07:00'
			await advanceBy(runner, 30_000)

			expect(firedDays()).toEqual(['2026-11-19'])
			expect(jobRows(db)).toMatchObject([{ status: 'done' }, { status: 'queued' }])
		})
	})

	describe("when the server restarts after the day's run", () => {
		beforeEach(async () => {
			jest.useFakeTimers({ now: new Date('2026-11-18T12:00:00Z') })
			timeZone = 'Asia/Tokyo'
			at = '07:00'
			await advanceTo(startScheduled(), '2026-11-18T22:00:00Z')
			await runner.stop()
			setSystemTime(new Date('2026-11-18T23:00:00Z'))
			startScheduled()
			await advanceBy(runner, 0)
		})

		it('does not fire again', () => {
			expect(run).toHaveBeenCalledTimes(1)
		})
	})
})
