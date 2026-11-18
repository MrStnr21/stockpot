// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { jest, mock, type Mock } from 'bun:test'
import type { TestDb } from '#tests/setup/db'
import { asc } from 'drizzle-orm'

import { jobs } from '#/server/db/schema/jobs'
import type { JobContext, Runner } from '#/server/jobs/types'

/** A mocked job handler. */
export type Handler<Payload> = Mock<(payload: Payload, context: JobContext) => Promise<void>>

/** A handler that succeeds at once. */
export function succeedingHandler<Payload>(): Handler<Payload> {
	return mock(async () => {
		// The job's own work is not under test.
	})
}

/** Every row of the jobs table, oldest first. */
// oxlint-disable-next-line typescript/explicit-module-boundary-types -- The row type comes from the schema.
export function jobRows(db: TestDb) {
	return db.select().from(jobs).orderBy(asc(jobs.id)).all()
}

/** Moves the fake clock on, fires the timers due by then and waits for the runner's worker. */
export async function advanceBy(runner: Runner, milliseconds: number): Promise<void> {
	jest.advanceTimersByTime(milliseconds)
	await runner.idle()
}

/** Moves the fake clock to an ISO time, as `advanceBy` does. */
export async function advanceTo(runner: Runner, time: string): Promise<void> {
	await advanceBy(runner, new Date(time).getTime() - Date.now())
}
