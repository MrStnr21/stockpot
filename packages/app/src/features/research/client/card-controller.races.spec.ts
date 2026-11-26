// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { afterEach, beforeEach, describe, expect, it, jest } from 'bun:test'
import { cardView, jobView, levelCard, levels } from '#tests/factories/card-views'
import { CardHarness } from '#tests/setup/card-controller'

import type { CardView } from '../shared/card-view'
import { waitingPollMs } from './poll'

function ready(id: number): CardView {
	return cardView('brief', {
		note: { id, status: 'ready' },
		levels: levels({ card: levelCard('brief', 1) }),
	})
}

/** Ready, with level 2 asked for now: the card polls every 10 s. */
function polled(id: number): CardView {
	return cardView('brief', {
		note: { id, status: 'ready' },
		levels: levels({ card: levelCard('brief', 1) }, { job: jobView({ priority: 'now' }) }),
	})
}

const gone = { error: { code: 'not_found', message: 'Gone.' } }

describe('CardController when requests cross', () => {
	let harness: CardHarness

	beforeEach(() => {
		jest.useFakeTimers()
	})

	afterEach(() => {
		harness.controller.destroy()
		jest.useRealTimers()
	})

	describe('an action while a poll is on its way', () => {
		let shown: CardView

		beforeEach(() => {
			shown = polled(5)
			harness = new CardHarness(shown)
			jest.advanceTimersByTime(waitingPollMs)
		})

		it.each([
			['a 404', 404],
			['the card from before', 200],
		] as const)(
			'keeps the deleted panel and its Undo when the poll answers %s',
			async (_, status) => {
				const running = harness.controller.run({ kind: 'delete' })

				harness.requests.call(1).answer(null, 204)
				await running
				harness.requests.call(0).answer(status === 404 ? gone : shown, status)

				expect([harness.requests.call(0).signal?.aborted, harness.controller.state]).toEqual([
					true,
					{ kind: 'deleted', view: shown, canUndo: true },
				])
			},
		)

		it('does not look again once the card is deleted, even when notes change elsewhere', async () => {
			const running = harness.controller.run({ kind: 'delete' })

			harness.requests.call(1).answer(null, 204)
			await running
			await harness.controller.refresh()

			expect(harness.requests.sent()).toEqual(['GET /api/notes/5/card', 'DELETE /api/notes/5'])
		})
	})

	describe('an action, then another note picked before its answer', () => {
		let next: CardView

		beforeEach(() => {
			next = ready(4)
			harness = new CardHarness(ready(3))
		})

		it('tells the list a delete landed and says so, and leaves the new card alone', async () => {
			const running = harness.controller.run({ kind: 'delete' })

			harness.controller.open(4).catch(() => null)
			harness.requests.call(0).answer(null, 204)
			await running
			harness.requests.call(1).answer(next)

			expect([harness.notesChanged, harness.toast(), harness.controller.state]).toEqual([
				1,
				'Note deleted',
				{ kind: 'card', view: next },
			])
		})

		it.each([
			['done', null, 204],
			['missing', gone, 404],
		] as const)(
			'tells the list when the action ends %s, without fetching the old card',
			async (_, body, status) => {
				const running = harness.controller.run({ kind: 'got' })

				harness.controller.open(4).catch(() => null)
				harness.requests.call(0).answer(body, status)
				await running
				harness.requests.call(1).answer(next)

				expect([harness.notesChanged, harness.requests.sent()]).toEqual([
					1,
					['PATCH /api/notes/3 {"status":"read"}', 'GET /api/notes/4/card'],
				])
				expect(harness.controller.state).toEqual({ kind: 'card', view: next })
			},
		)
	})

	describe('a pick whose card fails to load', () => {
		beforeEach(() => {
			harness = new CardHarness(ready(3))
			harness.controller.open(4).catch(() => null)
			harness.requests.call(0).fail(new TypeError('Failed to fetch'))
		})

		it('shows Try again for the picked note instead of the old card', () => {
			expect([harness.controller.state, harness.controller.loading]).toEqual([
				{ kind: 'unreachable', id: 4 },
				false,
			])
		})

		it('loads the picked note again on Try again', () => {
			const picked = ready(4)

			harness.controller.retry().catch(() => null)
			harness.requests.call(1).answer(picked)

			expect(harness.controller.state).toEqual({ kind: 'card', view: picked })
		})

		it('loads it again when the list picks it again, once while it loads', () => {
			harness.controller.open(4).catch(() => null)
			harness.controller.open(4).catch(() => null)

			expect(harness.requests.sent()).toEqual(['GET /api/notes/4/card', 'GET /api/notes/4/card'])
		})
	})
})
