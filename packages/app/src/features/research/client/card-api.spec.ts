// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { describe, expect, it } from 'bun:test'
import { cardView, levelCard, levels } from '#tests/factories/card-views'
import { CardFetch } from '#tests/setup/card-controller'

import { createCardApi } from './card-api'

function setUp() {
	const requests = new CardFetch()

	return { requests, api: createCardApi({ fetch: requests.fetch }) }
}

describe('card api', () => {
	it('parses the card view', async () => {
		const { requests, api } = setUp()
		const view = cardView('brief', { levels: levels({ card: levelCard('brief', 1) }) })
		const answer = api.card(view.note.id, new AbortController().signal)

		requests.call(0).answer(view)

		expect(await answer).toEqual({ kind: 'ok', value: view })
	})

	it.each([
		[401, { error: { code: 'unauthorized', message: 'Sign in.' } }, 'unauthorized'],
		[404, { error: { code: 'not_found', message: 'Gone.' } }, 'missing'],
		[409, { error: { code: 'no_card', message: 'No card.' } }, 'conflict'],
		[503, { error: { code: 'jobs_unavailable', message: 'Not running.' } }, 'unavailable'],
		[503, { error: { code: 'maintenance', message: 'Later.' } }, 'failed'],
		[500, { error: { code: 'internal', message: 'Broke.' } }, 'failed'],
		[202, { outcome: 'sideways', depth: 2 }, 'failed'],
	] as const)('reads a %d answer %p as %s', async (status, body, kind) => {
		const { requests, api } = setUp()
		const answer = api.deeper(1, false)

		requests.call(0).answer(body, status)

		expect(await answer).toEqual({ kind })
	})

	it('reads a network error as failed', async () => {
		const { requests, api } = setUp()
		const answer = api.remove(1)

		requests.call(0).fail(new TypeError('Failed to fetch'))

		expect(await answer).toEqual({ kind: 'failed' })
	})

	it('takes a 204 without a body', async () => {
		const { requests, api } = setUp()
		const answer = api.remove(1)

		requests.call(0).answer(null, 204)

		expect([await answer, requests.sent()]).toEqual([
			{ kind: 'ok', value: null },
			['DELETE /api/notes/1'],
		])
	})

	it('reads the level Deeper queued', async () => {
		const { requests, api } = setUp()
		const answer = api.deeper(1, true)

		requests.call(0).answer({ id: 1, outcome: 'queued', depth: 3 }, 202)

		expect([await answer, requests.sent()]).toEqual([
			{ kind: 'ok', value: { outcome: 'queued', depth: 3 } },
			['POST /api/notes/1/deeper {"now":true}'],
		])
	})
})
