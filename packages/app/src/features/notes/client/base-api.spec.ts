// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { beforeEach, describe, expect, it } from 'bun:test'
import { listedNoteFactory, notesPageFactory } from '#tests/factories/listed-notes'
import { NotesFetch } from '#tests/setup/notes-fetch'

import type { BaseOverview } from '../shared/types'
import { createBaseApi, type BaseApi } from './base-api'

describe('createBaseApi', () => {
	let requests: NotesFetch
	let api: BaseApi
	let aborts: AbortController

	beforeEach(() => {
		requests = new NotesFetch()
		api = createBaseApi({ fetch: requests.fetch })
		aborts = new AbortController()
	})

	describe('overview', () => {
		it('asks for Base with the signal and answers the parsed overview', async () => {
			const overview: BaseOverview = {
				total: 4,
				groups: [
					{ categoryId: 2, count: 3, notes: listedNoteFactory.buildList(3, { categoryId: 2 }) },
					{ categoryId: null, count: 1, notes: [listedNoteFactory.build({ categoryId: null })] },
				],
			}

			const result = api.overview(aborts.signal)

			requests.call(0).respond(Response.json(overview))

			expect([requests.call(0).url, requests.call(0).signal]).toEqual(['/api/base', aborts.signal])
			expect(await result).toEqual({ kind: 'ok', value: overview })
		})

		it('answers an overview that does not parse as failed', async () => {
			const result = api.overview(aborts.signal)

			requests.call(0).respond(Response.json({ total: -1, groups: [] }))

			expect(await result).toEqual({ kind: 'failed' })
		})
	})

	describe('page', () => {
		it.each([
			[{ categoryId: 3, cursor: null }, '/api/base/notes?categoryId=3'],
			[
				{ categoryId: 'none', cursor: 'MTcwMC4z' },
				'/api/base/notes?categoryId=none&cursor=MTcwMC4z',
			],
			[{ q: 'run fast', cursor: null }, '/api/base/notes?q=run+fast'],
		] as const)('asks for %p at %s', (query, url) => {
			api.page(query, aborts.signal).catch(() => null)

			expect(requests.call(0).url).toBe(url)
		})

		it('answers the parsed page', async () => {
			const page = notesPageFactory.build({
				notes: listedNoteFactory.buildList(2),
				nextCursor: 'next',
				total: 2,
			})

			const result = api.page({ q: 'run', cursor: null }, aborts.signal)

			requests.call(0).answer(page)

			expect(await result).toEqual({ kind: 'ok', value: page })
		})

		it('answers a 400 as invalid and a 401 as unauthorized', async () => {
			const invalid = api.page({ categoryId: 3, cursor: 'bad' }, aborts.signal)
			const unauthorized = api.page({ categoryId: 3, cursor: null }, aborts.signal)
			const error = { error: { code: 'invalid_query', message: 'x' } }

			requests.call(0).answer(error, 400)
			requests.call(1).answer(error, 401)

			expect([await invalid, await unauthorized]).toEqual([
				{ kind: 'invalid' },
				{ kind: 'unauthorized' },
			])
		})
	})
})
