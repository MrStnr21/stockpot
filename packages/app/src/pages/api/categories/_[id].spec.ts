// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test'
import { faker } from '@faker-js/faker'
import { categoryRowFactory } from '#tests/factories/categories'
import { noteRowFactory } from '#tests/factories/notes'
import { categoryRequests } from '#tests/setup/category-routes'
import { createTestDb, type TestDb } from '#tests/setup/db'

import { listCategories } from '#/features/categories/server'
import * as settings from '#/features/settings/server'
import * as instance from '#/server/db/instance'
import { HttpError } from '#/server/http'

import { DELETE, PATCH } from './[id]'

describe('/api/categories/:id', () => {
	let db: TestDb
	let send: ReturnType<typeof categoryRequests>
	let id: number
	let segment: string

	beforeEach(async () => {
		;({ db } = await createTestDb())
		send = categoryRequests(db)
		spyOn(instance, 'instanceDb').mockResolvedValue(db)
		;({ id } = await categoryRowFactory.transient({ db }).create())
		segment = String(id)
	})

	afterEach(() => {
		mock.restore()
	})

	describe.each([
		['PATCH', PATCH],
		['DELETE', DELETE],
	] as const)('%s', (method, handler) => {
		it.each([
			['device', 403, 'session_required'],
			['nobody', 401, 'unauthorized'],
		] as const)('refuses a write from %s', async (as, status, code) => {
			const response = await send(handler, method, { as, segment })

			expect([response.status, await response.json()]).toMatchObject([status, { error: { code } }])
		})

		it.each([
			['01', 400, 'invalid_id'],
			['404', 404, 'not_found'],
		] as const)('rejects category id %s', async (badId, status, code) => {
			const body = JSON.stringify({ instructions: faker.lorem.sentence() })
			const response = await send(handler, method, { segment: badId, body })

			expect([response.status, await response.json()]).toMatchObject([status, { error: { code } }])
		})
	})

	describe('PATCH', () => {
		it('returns the edited category', async () => {
			const instructions = faker.lorem.sentence()

			const response = await send(PATCH, 'PATCH', {
				segment,
				body: JSON.stringify({ instructions }),
			})

			expect([response.status, await response.json()]).toMatchObject([200, { id, instructions }])
		})

		it('refuses to change position', async () => {
			const response = await send(PATCH, 'PATCH', {
				segment,
				body: JSON.stringify({ position: 0 }),
			})

			expect([response.status, await response.json()]).toMatchObject([
				400,
				{ error: { code: 'invalid_body' } },
			])
		})

		it('reports a name conflict', async () => {
			const { name } = await categoryRowFactory.transient({ db }).create()
			const response = await send(PATCH, 'PATCH', { segment, body: JSON.stringify({ name }) })

			expect([response.status, await response.json()]).toMatchObject([
				409,
				{ error: { code: 'category_exists' } },
			])
		})
	})

	describe('DELETE', () => {
		beforeEach(() => {
			settings.updateSettings(db, {
				routing: { categories: { [id]: { engine: 'gemini', tier: 'fast' } } },
			})
		})

		it('deletes an unused category and clears its routing override', async () => {
			const response = await send(DELETE, 'DELETE', { segment })
			const repeated = await send(DELETE, 'DELETE', { segment })

			expect([
				response.status,
				repeated.status,
				settings.readSettings(db).routing.categories,
			]).toEqual([204, 404, {}])
		})

		it('asks for a target with the active note count and keeps the routing override', async () => {
			const captures = noteRowFactory.transient({ db })
			await captures.createList(2, { categoryId: id })
			await captures.create({ categoryId: id, deletedAt: faker.date.recent() })

			const response = await send(DELETE, 'DELETE', { segment })

			expect([
				response.status,
				await response.json(),
				Object.keys(settings.readSettings(db).routing.categories),
			]).toMatchObject([409, { error: { code: 'category_in_use', notes: 2 } }, [segment]])
		})

		it.each(['', '-1', '404', '1&moveTo=2'])('rejects an invalid moveTo=%s', async (target) => {
			const response = await send(DELETE, 'DELETE', { segment, search: `?moveTo=${target}` })

			expect([response.status, await response.json()]).toMatchObject([
				400,
				{ error: { code: 'invalid_query' } },
			])
		})

		it('moves notes to the requested target and clears the source override', async () => {
			const target = await categoryRowFactory.transient({ db }).create()
			await noteRowFactory.transient({ db }).create({ categoryId: id })
			const response = await send(DELETE, 'DELETE', { segment, search: `?moveTo=${target.id}` })

			expect([
				response.status,
				listCategories(db).find((category) => category.id === target.id)?.noteCount,
				settings.readSettings(db).routing.categories,
			]).toEqual([204, 1, {}])
		})

		describe('when routing cleanup fails', () => {
			beforeEach(() => {
				spyOn(settings, 'removeCategoryRouting').mockImplementation(() => {
					throw new HttpError(503, { code: 'unavailable', message: 'Settings are unavailable.' })
				})
			})

			it('rolls back the category deletion and the note move', async () => {
				const target = await categoryRowFactory.transient({ db }).create()
				await noteRowFactory.transient({ db }).create({ categoryId: id })

				const response = await send(DELETE, 'DELETE', { segment, search: `?moveTo=${target.id}` })

				expect([
					response.status,
					listCategories(db).find((category) => category.id === id)?.noteCount,
				]).toEqual([503, 1])
			})
		})
	})
})
