// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { afterEach, beforeEach, describe, expect, it, jest } from 'bun:test'
import { cardView, jobView, levelCard, levels, type LevelParts } from '#tests/factories/card-views'
import { FakeVisibility } from '#tests/setup/page-visibility'

import { cardPoller, pollDelay, Poller, researchingPollMs, waitingPollMs } from './poll'

const ready = { card: levelCard('brief', 1) }

const now = Date.parse('2026-11-19T07:00:00Z')

const due = '2026-11-19T06:31:00.000Z'

const later = '2026-11-19T22:30:00.000Z'

const writing = { job: jobView({ state: 'researching', runAt: due }) }

const askedNow = { job: jobView({ priority: 'now', runAt: due }) }

const tonight = { job: jobView({ runAt: later }) }

const afterReset = { job: jobView({ priority: 'now', runAt: later }) }

const researchingNote = cardView('brief', { note: { status: 'researching' } })

const queuedNote = cardView('brief', { note: { status: 'queued' } })

const queuedDue = cardView('brief', {
	note: { status: 'queued' },
	levels: levels({ job: jobView({ runAt: due }) }),
})

const queuedTonight = cardView('brief', { note: { status: 'queued' }, levels: levels(tonight) })

function readCard(...given: LevelParts[]) {
	return cardView('brief', { note: { status: 'read' }, levels: levels(...given) })
}

describe('poll', () => {
	describe('pollDelay', () => {
		it.each([
			['a researching note', researchingNote, researchingPollMs],
			['a level being written', readCard(ready, writing), researchingPollMs],
			['a queued note with a due job', queuedDue, waitingPollMs],
			['a level asked for now and due', readCard(ready, askedNow), waitingPollMs],
			['a queued note whose job waits for tonight', queuedTonight, null],
			['a queued note without a job', queuedNote, null],
			['a level that waits for tonight', readCard(ready, tonight), null],
			['a level that waits for a limit to reset', readCard(ready, afterReset), null],
			['a settled card', readCard(ready), null],
			['a new note', cardView('brief'), null],
		])('waits for %s: %p', (_case, view, delay) => {
			expect(pollDelay(view, now)).toBe(delay)
		})
	})

	describe('Poller', () => {
		let visibility: FakeVisibility
		let delay: number | null
		let looks: number
		let finish: (() => void) | null
		let poller: Poller

		beforeEach(() => {
			jest.useFakeTimers()
			visibility = new FakeVisibility()
			delay = researchingPollMs
			looks = 0
			finish = null
			poller = new Poller({
				delay: () => delay,
				refetch: async () => {
					looks += 1

					const { promise, resolve } = Promise.withResolvers<boolean>()

					finish = () => {
						resolve(true)
					}

					await promise
				},
				visibility,
			})
		})

		afterEach(() => {
			poller.stop()
			jest.useRealTimers()
		})

		async function answer() {
			finish?.()
			finish = null
			await Promise.resolve()
			await Promise.resolve()
		}

		it('looks after the delay, and plans the next look only once the answer is in', async () => {
			poller.update()
			jest.advanceTimersByTime(researchingPollMs - 1)

			expect(looks).toBe(0)

			jest.advanceTimersByTime(1)
			jest.advanceTimersByTime(researchingPollMs * 5)

			expect(looks).toBe(1)

			delay = waitingPollMs
			await answer()
			jest.advanceTimersByTime(waitingPollMs)

			expect(looks).toBe(2)
		})

		it('stops once nothing is pending', async () => {
			poller.update()
			jest.advanceTimersByTime(researchingPollMs)
			delay = null
			await answer()
			jest.advanceTimersByTime(waitingPollMs * 10)

			expect(looks).toBe(1)
		})

		it('pauses while the page is hidden and looks at once when it is shown', () => {
			poller.update()
			visibility.set(true)
			jest.advanceTimersByTime(waitingPollMs * 10)

			expect(looks).toBe(0)

			visibility.set(false)

			expect(looks).toBe(1)
		})

		it('does not look again on being shown while a look is out', () => {
			poller.update()
			jest.advanceTimersByTime(researchingPollMs)
			visibility.set(true)
			visibility.set(false)

			expect(looks).toBe(1)
		})

		it('looks no more once stopped, shown or not', () => {
			poller.update()
			poller.stop()
			visibility.set(true)
			visibility.set(false)
			jest.advanceTimersByTime(waitingPollMs)

			expect(looks).toBe(0)
		})
	})

	describe('cardPoller', () => {
		let visibility: FakeVisibility
		let looks: number
		let poller: Poller

		function watch(view: Parameters<typeof pollDelay>[0]) {
			poller = cardPoller(
				() => view,
				async () => {
					looks += 1
				},
				{ visibility, now: () => now },
			)
			poller.update()
		}

		beforeEach(() => {
			jest.useFakeTimers()
			visibility = new FakeVisibility()
			looks = 0
		})

		afterEach(() => {
			poller.stop()
			jest.useRealTimers()
		})

		it('sets no timer for a job that waits for tonight', () => {
			watch(queuedTonight)
			jest.advanceTimersByTime(waitingPollMs * 100)

			expect([jest.getTimerCount(), looks]).toEqual([0, 0])
		})

		it('looks every 10 s while a job is due', () => {
			watch(queuedDue)
			jest.advanceTimersByTime(waitingPollMs - 1)

			expect(looks).toBe(0)

			jest.advanceTimersByTime(1)

			expect(looks).toBe(1)
		})

		it('looks every 3 s while an engine writes', () => {
			watch(researchingNote)
			jest.advanceTimersByTime(researchingPollMs)

			expect(looks).toBe(1)
		})

		it('looks once when the page is shown again, even for a job that waits for tonight', () => {
			watch(queuedTonight)
			visibility.set(true)
			visibility.set(false)

			expect([looks, jest.getTimerCount()]).toEqual([1, 0])
		})

		it('does not look on being shown for a settled card', () => {
			watch(readCard(ready))
			visibility.set(true)
			visibility.set(false)

			expect(looks).toBe(0)
		})
	})
})
