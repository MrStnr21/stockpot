// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { afterEach, beforeEach, describe, expect, it, jest } from 'bun:test'
import { cardView, jobView, levelCard, levels } from '#tests/factories/card-views'
import { CardHarness } from '#tests/setup/card-controller'

import type { CardView } from '../shared/card-view'
import type { CardAction } from './card-actions'

const id = 7

function readyCard(changes: Partial<CardView['note']> = {}): CardView {
	return cardView('technology', {
		note: { id, status: 'ready', ...changes },
		levels: levels({ card: levelCard('technology', 1) }),
	})
}

const serverError = { error: { code: 'internal', message: 'Something broke.' } }

describe('CardController actions', () => {
	let harness: CardHarness

	beforeEach(() => {
		jest.useFakeTimers()
		harness = new CardHarness(readyCard())
	})

	afterEach(() => {
		harness.controller.destroy()
		jest.useRealTimers()
	})

	/** Runs the action, answers it with `status`, and answers the card's refetch with `after`. */
	async function act(action: CardAction, status = 200, after: CardView = readyCard()) {
		const running = harness.controller.run(action)

		harness.requests
			.call(-1)
			.answer(status === 204 ? null : { outcome: 'queued', depth: 2 }, status)

		if (harness.requests.calls.at(-1)?.url === `/api/notes/${id}/card`) {
			harness.requests.call(-1).answer(after)
		}

		await running
	}

	it.each([
		[{ kind: 'got' }, 'PATCH /api/notes/7 {"status":"read"}', 'Marked as read'],
		[{ kind: 'keep' }, 'PATCH /api/notes/7 {"kept":true}', 'Kept in Base'],
		[{ kind: 'archive' }, 'PATCH /api/notes/7 {"status":"archived"}', 'Archived'],
		[
			{ kind: 'move', categoryId: 3, categoryName: 'Concept' },
			'PATCH /api/notes/7 {"categoryId":3}',
			'Moved to Concept',
		],
		[{ kind: 'deeper' }, 'POST /api/notes/7/deeper {}', 'How it works comes tonight'],
		[{ kind: 'researchLevel' }, 'POST /api/notes/7/deeper {"now":true}', undefined],
		[{ kind: 'research' }, 'POST /api/notes/7/research {}', undefined],
	] as const)('sends %p, fetches the card again and says so', async (action, request, toast) => {
		await act(action)

		expect(harness.requests.sent()).toEqual([request, 'GET /api/notes/7/card'])
		expect([harness.toast(), harness.notesChanged]).toEqual([toast, 1])
	})

	it('moves the depth switch to the level Deeper asked for', async () => {
		await act({ kind: 'deeper' })

		expect(harness.controller.picked).toBe(2)
	})

	it('takes a kept note out of Base', async () => {
		harness.controller.destroy()
		harness = new CardHarness(readyCard({ isKept: true }))

		await act({ kind: 'keep' })

		expect([harness.requests.sent()[0], harness.toast()]).toEqual([
			'PATCH /api/notes/7 {"kept":false}',
			'Removed from Base',
		])
	})

	it('shows what the server answers, not what it asked for', async () => {
		await act({ kind: 'got' }, 200, readyCard({ status: 'read' }))

		expect(harness.view()?.note.status).toBe('read')
	})

	it('sends once on a double tap, and refuses every action while one runs', async () => {
		const first = harness.controller.run({ kind: 'got' })

		harness.controller.run({ kind: 'got' }).catch(() => null)
		harness.controller.run({ kind: 'keep' }).catch(() => null)

		expect([harness.requests.calls.length, harness.controller.canAct]).toEqual([1, false])

		harness.requests.call(0).answer({ outcome: 'ok' })
		harness.requests.call(1).answer(readyCard())
		await first

		expect([harness.requests.calls.length, harness.controller.canAct]).toEqual([2, true])
	})

	it('deletes without asking, then Undo brings the card back', async () => {
		await act({ kind: 'delete' }, 204)

		expect(harness.controller.state).toMatchObject({ kind: 'deleted', canUndo: true })

		await act({ kind: 'undo' })

		expect(harness.requests.sent()).toEqual([
			'DELETE /api/notes/7',
			'PATCH /api/notes/7 {"deleted":false}',
			'GET /api/notes/7/card',
		])
		expect([harness.controller.state.kind, harness.notesChanged]).toEqual(['card', 2])
	})

	it('offers no Undo for a note that was already gone', async () => {
		await act({ kind: 'delete' }, 404)
		harness.controller.run({ kind: 'undo' }).catch(() => null)

		expect(harness.controller.state).toMatchObject({ kind: 'deleted', canUndo: false })
		expect(harness.requests.calls).toHaveLength(1)
	})

	it('signs in again on a 401', async () => {
		await act({ kind: 'got' }, 401)

		expect([harness.signIns, harness.requests.calls.length]).toEqual([1, 1])
	})

	it('shows "There is no such note" on a 404', async () => {
		await act({ kind: 'keep' }, 404)

		expect(harness.controller.state).toEqual({ kind: 'missing' })
	})

	it('fetches the card again and says so on a 409', async () => {
		await act({ kind: 'got' }, 409, readyCard({ status: 'read' }))

		expect([harness.view()?.note.status, harness.toast(), harness.notesChanged]).toEqual([
			'read',
			'This note changed elsewhere. Showing the latest.',
			0,
		])
	})

	it('says research cannot start without a job runner', async () => {
		const running = harness.controller.run({ kind: 'deeper' })

		harness.requests
			.call(0)
			.answer({ error: { code: 'jobs_unavailable', message: 'Not running.' } }, 503)
		await running

		expect(harness.toast()).toBe('Research can’t start right now. Try again in a moment.')
	})

	it.each([
		[
			'a server error',
			() => {
				harness.requests.call(0).answer(serverError, 500)
			},
		],
		[
			'a network error',
			() => {
				harness.requests.call(0).fail(new TypeError('Failed to fetch'))
			},
		],
		[
			'an answer that does not parse',
			() => {
				harness.requests.call(0).answer({ outcome: 'sideways' })
			},
		],
	])('changes nothing on %s and says so', async (_case, answer) => {
		const running = harness.controller.run({ kind: 'deeper' })

		answer()
		await running

		expect([harness.toast(), harness.requests.calls.length, harness.notesChanged]).toEqual([
			'Couldn’t reach your server. Nothing changed.',
			1,
			0,
		])
	})

	it('tells the page when research it was polling for finishes', async () => {
		harness.controller.destroy()
		const job = jobView({ state: 'researching' })

		harness = new CardHarness(
			cardView('technology', { note: { id, status: 'researching' }, levels: levels({ job }) }),
		)

		jest.advanceTimersByTime(3000)
		harness.requests.call(0).answer(readyCard())
		await Promise.resolve()

		expect([harness.view()?.note.status, harness.notesChanged]).toEqual(['ready', 1])
	})
})
