// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test'
import { categoryRequests } from '#tests/setup/category-routes'
import { createTestDb, type TestDb } from '#tests/setup/db'

import { listCategories } from '#/features/categories/server'
import * as instance from '#/server/db/instance'

import { PUT } from './order'

describe('PUT /api/categories/order', () => {
	let db: TestDb
	let send: ReturnType<typeof categoryRequests>
	let ids: number[]

	beforeEach(async () => {
		;({ db } = await createTestDb())
		send = categoryRequests(db)
		spyOn(instance, 'instanceDb').mockResolvedValue(db)
		ids = listCategories(db)
			.map(({ id }) => id)
			.toReversed()
	})

	afterEach(() => {
		mock.restore()
	})

	it('saves the requested order', async () => {
		const response = await send(PUT, 'PUT', { segment: 'order', body: JSON.stringify({ ids }) })

		expect([response.status, listCategories(db).map(({ id, position }) => [id, position])]).toEqual(
			[204, ids.map((id, position) => [id, position])],
		)
	})

	it.each([
		['device', 403, 'session_required'],
		['nobody', 401, 'unauthorized'],
	] as const)('refuses a write from %s', async (as, status, code) => {
		const response = await send(PUT, 'PUT', { as, segment: 'order', body: JSON.stringify({ ids }) })

		expect([response.status, await response.json()]).toMatchObject([status, { error: { code } }])
	})

	it.each([
		['malformed JSON', '{', 'invalid_json'],
		['a missing list', '{}', 'invalid_body'],
		['an incomplete order', '{"ids":[]}', 'invalid_body'],
	])('answers 400 for %s', async (_case, body, code) => {
		const response = await send(PUT, 'PUT', { segment: 'order', body })

		expect([response.status, await response.json()]).toMatchObject([400, { error: { code } }])
	})
})
