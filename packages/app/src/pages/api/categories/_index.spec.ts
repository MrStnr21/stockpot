// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test'
import { faker } from '@faker-js/faker'
import { categoryRowFactory } from '#tests/factories/categories'
import { noteRowFactory } from '#tests/factories/notes'
import { categoryRequests } from '#tests/setup/category-routes'
import { createTestDb, type TestDb } from '#tests/setup/db'
import * as v from 'valibot'

import * as instance from '#/server/db/instance'

import { GET, POST } from './index'

const category = categoryRowFactory.params({ color: 'tech', icon: 'book' })

const listResponse = v.object({ categories: v.array(v.unknown()) })

describe('/api/categories', () => {
	let db: TestDb
	let send: ReturnType<typeof categoryRequests>

	beforeEach(async () => {
		;({ db } = await createTestDb())
		send = categoryRequests(db)
		spyOn(instance, 'instanceDb').mockResolvedValue(db)
	})

	afterEach(() => {
		mock.restore()
	})

	describe('GET', () => {
		it.each(['device', 'owner'] as const)(
			'lists categories and active note counts for a %s',
			async (as) => {
				const filed = await category.transient({ db }).create({ position: 6 })
				const captures = noteRowFactory.transient({ db })
				await captures.create({ categoryId: filed.id })
				await captures.create({ categoryId: filed.id, deletedAt: faker.date.recent() })

				const response = await send(GET, 'GET', { as })
				const { categories } = v.parse(listResponse, await response.json())

				expect([response.status, categories.at(-1)]).toMatchObject([
					200,
					{ id: filed.id, name: filed.name, position: filed.position, noteCount: 1 },
				])
			},
		)

		it('requires authentication', async () => {
			const response = await send(GET, 'GET', { as: 'nobody' })

			expect([response.status, await response.json()]).toMatchObject([
				401,
				{ error: { code: 'unauthorized' } },
			])
		})
	})

	describe('POST', () => {
		it('appends the category and returns the saved fields', async () => {
			const fields = category.build()
			const response = await send(POST, 'POST', { body: JSON.stringify(fields) })

			expect([response.status, await response.json()]).toMatchObject([
				201,
				{ ...fields, position: 6, instructions: '' },
			])
		})

		it.each([
			['device', 403, 'session_required'],
			['nobody', 401, 'unauthorized'],
		] as const)('refuses a write from %s', async (as, status, code) => {
			const response = await send(POST, 'POST', { as, body: JSON.stringify(category.build()) })

			expect([response.status, await response.json()]).toMatchObject([status, { error: { code } }])
		})

		it.each([
			['{', 'invalid_json'],
			['{}', 'invalid_body'],
		])('rejects the body %s', async (body, code) => {
			const response = await send(POST, 'POST', { body })

			expect([response.status, await response.json()]).toMatchObject([400, { error: { code } }])
		})

		it('reports a name already in use', async () => {
			const { name } = await category.transient({ db }).create()
			const fields = category.build({ name: name.toUpperCase() })

			const response = await send(POST, 'POST', { body: JSON.stringify(fields) })

			expect([response.status, await response.json()]).toMatchObject([
				409,
				{ error: { code: 'category_exists' } },
			])
		})
	})
})
