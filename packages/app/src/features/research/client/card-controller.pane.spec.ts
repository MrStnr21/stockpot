// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { afterEach, beforeEach, describe, expect, it, jest } from 'bun:test'
import { cardView, jobView, levelCard, levels } from '#tests/factories/card-views'
import { CardHarness } from '#tests/setup/card-controller'

import type { CardView } from '../shared/card-view'
import { researchingPollMs, waitingPollMs } from './poll'

function note(id: number, status: CardView['note']['status'] = 'ready'): CardView {
	return cardView('brief', {
		note: { id, status },
		levels: levels(status === 'ready' || status === 'read' ? { card: levelCard('brief', 1) } : {}),
	})
}

/** Queued, with its research job due: the worker takes it next. */
function queuedDue(id: number): CardView {
	return cardView('brief', { note: { id, status: 'queued' }, levels: levels({ job: jobView() }) })
}

function researching(id: number): CardView {
	return cardView('brief', {
		note: { id, status: 'researching' },
		levels: levels({ job: jobView({ state: 'researching' }) }),
	})
}

describe('CardController polling and the pane', () => {
	let harness: CardHarness

	beforeEach(() => {
		jest.useFakeTimers()
	})

	afterEach(() => {
		harness.controller.destroy()
		jest.useRealTimers()
	})

	describe('the pane', () => {
		beforeEach(() => {
			harness = new CardHarness(null)
		})

		it('starts empty and loads the note the list opens, marked busy meanwhile', () => {
			harness.controller.open(3).catch(() => null)

			expect([harness.controller.state.kind, harness.controller.loading]).toEqual(['empty', true])

			harness.requests.call(0).answer(note(3))

			expect([harness.view()?.note.id, harness.controller.loading]).toEqual([3, false])
		})

		it('shows the newest pick: an older answer is aborted and dropped', () => {
			harness.controller.open(3).catch(() => null)
			harness.controller.open(4).catch(() => null)
			harness.requests.call(1).answer(note(4))
			harness.requests.call(0).answer(note(3))

			expect([harness.requests.call(0).signal?.aborted, harness.view()?.note.id]).toEqual([true, 4])
		})

		it('loads nothing for the note it already shows', () => {
			harness.controller.open(3).catch(() => null)
			harness.requests.call(0).answer(note(3))
			harness.controller.open(3).catch(() => null)

			expect(harness.requests.calls).toHaveLength(1)
		})

		it('starts on level 1 for each note', () => {
			harness.controller.open(3).catch(() => null)
			harness.requests.call(0).answer(note(3))
			harness.controller.pick(2)
			harness.controller.open(4).catch(() => null)

			expect(harness.controller.picked).toBe(1)
		})

		it('says there is no such note on a 404', () => {
			harness.controller.open(3).catch(() => null)
			harness.requests.call(0).answer({ error: { code: 'not_found', message: 'Gone.' } }, 404)

			expect(harness.controller.state).toEqual({ kind: 'missing' })
		})

		it('refuses actions while another note loads, and after it failed to load', () => {
			harness.controller.open(3).catch(() => null)
			harness.requests.call(0).answer(note(3))
			harness.controller.open(4).catch(() => null)
			harness.controller.run({ kind: 'got' }).catch(() => null)
			harness.requests.call(1).fail(new TypeError('Failed to fetch'))
			harness.controller.run({ kind: 'got' }).catch(() => null)

			expect([harness.requests.calls.length, harness.toast()]).toEqual([
				2,
				'Couldn’t reach your server.',
			])
		})
	})

	describe('polling', () => {
		it('looks every 3 s while an engine writes, and every 10 s while a job waits', () => {
			harness = new CardHarness(researching(5))
			jest.advanceTimersByTime(researchingPollMs)
			harness.requests.call(0).answer(queuedDue(5))
			jest.advanceTimersByTime(researchingPollMs)

			expect(harness.requests.calls).toHaveLength(1)

			jest.advanceTimersByTime(waitingPollMs - researchingPollMs)

			expect(harness.requests.sent()).toEqual(['GET /api/notes/5/card', 'GET /api/notes/5/card'])
		})

		it('stops once the card is settled', () => {
			harness = new CardHarness(researching(5))
			jest.advanceTimersByTime(researchingPollMs)
			harness.requests.call(0).answer(note(5))
			jest.advanceTimersByTime(waitingPollMs * 10)

			expect(harness.requests.calls).toHaveLength(1)
		})

		it('waits while the tab is hidden and looks at once when it is shown', () => {
			harness = new CardHarness(researching(5))
			harness.visibility.set(true)
			jest.advanceTimersByTime(waitingPollMs * 10)

			expect(harness.requests.calls).toHaveLength(0)

			harness.visibility.set(false)

			expect(harness.requests.calls).toHaveLength(1)
		})

		it('never lets an older poll overwrite the card an action fetched', async () => {
			const card = levelCard('brief', 1)
			const job = jobView({ priority: 'now' })

			harness = new CardHarness(
				cardView('brief', { note: { id: 5, status: 'ready' }, levels: levels({ card }, { job }) }),
			)
			jest.advanceTimersByTime(waitingPollMs)

			const running = harness.controller.run({ kind: 'got' })

			harness.requests.call(1).answer({ outcome: 'ok' })
			harness.requests.call(2).answer(note(5, 'read'))
			await running
			harness.requests.call(0).answer(note(5, 'ready'))

			expect([harness.requests.call(0).signal?.aborted, harness.view()?.note.status]).toEqual([
				true,
				'read',
			])
		})

		it('drops a poll answer once the pane shows another note', () => {
			harness = new CardHarness(researching(5))
			jest.advanceTimersByTime(researchingPollMs)
			harness.controller.open(6).catch(() => null)
			harness.requests.call(1).answer(note(6))
			harness.requests.call(0).answer(note(5))

			expect(harness.view()?.note.id).toBe(6)
		})

		it('does not poll a deleted card', async () => {
			harness = new CardHarness(researching(5))

			const running = harness.controller.run({ kind: 'delete' })

			harness.requests.call(0).answer(null, 204)
			await running
			jest.advanceTimersByTime(waitingPollMs * 10)

			expect(harness.requests.sent()).toEqual(['DELETE /api/notes/5'])
		})
	})
})
