// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test'
import { categoryRowFactory } from '#tests/factories/categories'
import { sendThroughMiddleware, signedInInstance } from '#tests/setup/auth'
import { createTestDb, type TestDb } from '#tests/setup/db'

import { readSettings } from '#/features/settings/server'
import type { FormatId } from '#/lib/format-ids'
import * as instance from '#/server/db/instance'
import type { JsonValue } from '#/server/engines/contract'

import { PUT } from './engine'

const publicOrigin = 'http://127.0.0.1:4321'

interface Sent {
	readonly id: string
	readonly body: JsonValue
	readonly as?: 'owner' | 'device' | 'nobody' | 'another site'
}

describe('PUT /api/categories/:id/engine', () => {
	let db: TestDb
	let send: (sent: Sent) => Promise<Response>

	beforeEach(async () => {
		;({ db } = await createTestDb())
		spyOn(instance, 'instanceDb').mockResolvedValue(db)

		const { auth, session } = signedInInstance(db, publicOrigin)

		send = async ({ id, body, as = 'owner' }) => {
			const headers = new Headers({ 'content-type': 'application/json' })

			if (as === 'device') {
				headers.set('authorization', `Bearer ${auth.devices.create('Shortcut').token}`)
			} else if (as === 'another site') {
				headers.set('sec-fetch-site', 'cross-site')
			} else if (as === 'owner') {
				headers.set('origin', publicOrigin)
			}

			const request = new Request(`${publicOrigin}/api/categories/${id}/engine`, {
				method: 'PUT',
				headers,
				body: JSON.stringify(body),
			})

			const cookies = as === 'owner' || as === 'another site' ? session : undefined

			return sendThroughMiddleware(
				{ auth, publicOrigin },
				{ request, cookies, params: { id } },
				PUT,
			)
		}
	})

	afterEach(() => {
		mock.restore()
	})

	async function categoryId(format: FormatId = 'technology') {
		const { id } = await categoryRowFactory.transient({ db }).create({ format })

		return String(id)
	}

	it.each([
		['report', 'deep'],
		['technology', 'standard'],
		['vocabulary', 'fast'],
	] as const)('routes a %s category at the tier it writes at, %s', async (format, tier) => {
		const id = await categoryId(format)
		const response = await send({ id, body: { engine: 'openai-compatible' } })

		expect([response.status, readSettings(db).routing.categories]).toEqual([
			204,
			{ [id]: { engine: 'openai-compatible', tier } },
		])
	})

	it('sends the category back to the default engine with null', async () => {
		const id = await categoryId()

		await send({ id, body: { engine: 'agent-command' } })

		const response = await send({ id, body: { engine: null } })

		expect([response.status, readSettings(db).routing.categories]).toEqual([204, {}])
	})

	it.each([
		['404', 404, 'not_found'],
		['01', 400, 'invalid_id'],
	] as const)('refuses category id %s', async (id, status, code) => {
		const response = await send({ id, body: { engine: 'gemini' } })

		expect([response.status, await response.json()]).toMatchObject([status, { error: { code } }])
	})

	it.each([
		['an unknown engine', { engine: 'local' }],
		['a tier', { engine: 'gemini', tier: 'deep' }],
		['no engine', {}],
	])('refuses %s', async (_name, body) => {
		const response = await send({ id: await categoryId(), body })

		expect([response.status, await response.json()]).toMatchObject([
			400,
			{ error: { code: 'invalid_body' } },
		])
	})

	it.each([
		['device', 403],
		['nobody', 401],
		['another site', 403],
	] as const)('refuses a request from %s, changing nothing', async (as, status) => {
		const response = await send({ id: await categoryId(), body: { engine: 'gemini' }, as })

		expect([response.status, readSettings(db).routing.categories]).toEqual([status, {}])
	})
})
