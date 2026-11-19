// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { afterEach, beforeEach, describe, expect, it, spyOn, type Mock } from 'bun:test'
import { createTestDb } from '#tests/setup/db'

import type { EngineResult } from './contract'
import { oneAtATime, recordRun, type Line } from './runs'

describe('runs', () => {
	describe('recordRun', () => {
		describe('with a database that cannot take the row', () => {
			let logged: Mock<typeof console.error>
			let result: EngineResult<string>

			beforeEach(async () => {
				const { sqlite, db } = await createTestDb()

				logged = spyOn(console, 'error').mockImplementation(() => {
					// The spec checks the call; the message would only clutter the output.
				})
				sqlite.close()
				result = await recordRun(
					{ db, engine: 'agent-command', task: 'suggest', jobId: null },
					async () => 'the answer',
				)
			})

			afterEach(() => {
				logged.mockRestore()
			})

			it("keeps the call's answer and logs the lost row", () => {
				expect(result).toMatchObject({ output: 'the answer', engine: 'agent-command' })
				expect(logged).toHaveBeenCalledTimes(1)
			})
		})
	})

	describe('oneAtATime', () => {
		describe('with a call that leaves the line while it waits', () => {
			const reason = new Error('No longer needed')
			let events: string[]
			let left: Error | null

			beforeEach(async () => {
				events = []

				const inTurn: Line = oneAtATime()
				const controller = new AbortController()
				const { promise: firstDone, resolve: finishFirst } = Promise.withResolvers<null>()

				const first = inTurn(undefined, async () => {
					events.push('first starts')
					await firstDone
					events.push('first ends')
				})

				const second = inTurn(controller.signal, async () => {
					events.push('second runs')
				})

				const third = inTurn(undefined, async () => {
					events.push('third runs')
				})

				controller.abort(reason)

				try {
					await second
					left = null
				} catch (error) {
					left = error instanceof Error ? error : null
				}

				events.push('second left')
				finishFirst(null)
				await Promise.all([first, third])
			})

			it('rejects it with the reason at once, before the call ahead finishes', () => {
				expect(left).toBe(reason)
				expect(events.indexOf('second left')).toBeLessThan(events.indexOf('first ends'))
			})

			it('never runs it and keeps the rest in order', () => {
				const ran = events.filter((event) => event !== 'second left')

				expect(ran).toEqual(['first starts', 'first ends', 'third runs'])
			})
		})
	})
})
