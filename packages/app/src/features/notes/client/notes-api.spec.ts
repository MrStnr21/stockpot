// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { beforeEach, describe, expect, it } from 'bun:test'
import { listedNoteFactory, notesPageFactory } from '#tests/factories/listed-notes'
import { NotesFetch } from '#tests/setup/notes-fetch'

import type { CountRow, NotesPage, ResearchResult } from '../shared/types'
import { createNotesApi, type ApiResult, type NotesApi } from './notes-api'

describe('createNotesApi', () => {
	let requests: NotesFetch
	let api: NotesApi

	beforeEach(() => {
		requests = new NotesFetch()
		api = createNotesApi({ fetch: requests.fetch })
	})

	describe('listPage', () => {
		let result: Promise<ApiResult<NotesPage>>

		beforeEach(() => {
			result = api.listPage(
				{ status: 'ready', categoryId: 3, q: 'kaf' },
				'MTcwMC4z',
				new AbortController().signal,
			)
		})

		it('asks for the view and its cursor, with the signal', () => {
			expect(requests.call(0)).toMatchObject({
				url: '/api/notes?status=ready&categoryId=3&q=kaf&cursor=MTcwMC4z',
				method: 'GET',
			})
			expect(requests.call(0).signal).toBeInstanceOf(AbortSignal)
		})

		it('answers the parsed page', async () => {
			const page = notesPageFactory.build({
				notes: [
					listedNoteFactory.build({
						flag: 'unsure',
						snippet: [
							{ text: 'about ', match: false },
							{ text: 'kaf', match: true },
						],
					}),
				],
				nextCursor: 'next',
				total: 1,
			})

			requests.call(0).answer(page)

			expect(await result).toEqual({ kind: 'ok', value: page })
		})

		it.each<[string, number, ApiResult<NotesPage>]>([
			['a 401', 401, { kind: 'unauthorized' }],
			['a 400', 400, { kind: 'invalid' }],
			['a 500', 500, { kind: 'failed' }],
			['a 503', 503, { kind: 'failed' }],
		])('answers %s as its kind', async (_name, status, kind) => {
			requests.call(0).answer({ error: { code: 'x', message: 'x' } }, status)

			expect(await result).toEqual(kind)
		})

		it.each([
			['a body that is not JSON', new Response('<html>', { status: 200 })],
			[
				'a note with an unknown status',
				Response.json({
					...notesPageFactory.build(),
					notes: [{ ...listedNoteFactory.build(), status: 'gone' }],
				}),
			],
			['a page without notes', Response.json({ nextCursor: null, total: null })],
		])('answers %s as failed', async (_name, response) => {
			requests.call(0).respond(response)

			expect(await result).toEqual({ kind: 'failed' })
		})

		it('answers a network error or an abort as failed', async () => {
			requests.call(0).fail(new DOMException('The operation was aborted.', 'AbortError'))

			expect(await result).toEqual({ kind: 'failed' })
		})
	})

	describe('counts', () => {
		it('answers the groups', async () => {
			const counts: CountRow[] = [{ categoryId: null, status: 'failed', count: 2 }]
			const result = api.counts(new AbortController().signal)

			requests.call(0).answer({ counts })

			expect(requests.call(0).url).toBe('/api/notes/counts')
			expect(await result).toEqual({ kind: 'ok', value: counts })
		})
	})

	describe('researchNow', () => {
		it('posts the ids and answers each outcome', async () => {
			const results: ResearchResult[] = [
				{ id: 4, outcome: 'queued' },
				{ id: 2, outcome: 'not_found' },
			]

			const result = api.researchNow([4, 2])

			requests.call(0).answer({ results })

			expect(requests.call(0)).toMatchObject({
				url: '/api/notes/research',
				method: 'POST',
				body: { ids: [4, 2] },
			})
			expect(await result).toEqual({ kind: 'ok', value: results })
		})

		it('answers 503 without a job runner as failed', async () => {
			const result = api.researchNow([4])

			requests.call(0).answer({ error: { code: 'unavailable', message: 'x' } }, 503)

			expect(await result).toEqual({ kind: 'failed' })
		})
	})

	describe('changeNotes', () => {
		it.each([
			[{ categoryId: 5 }, { ids: [3, 1], categoryId: 5 }],
			[{ status: 'archived' } as const, { ids: [3, 1], status: 'archived' }],
		])('patches the notes with %o', async (change, body) => {
			const result = api.changeNotes([3, 1], change)

			requests.call(0).answer({
				results: [
					{ id: 3, outcome: 'changed', note: listedNoteFactory.build({ id: 3 }) },
					{ id: 1, outcome: 'not_found', note: null },
				],
			})

			expect(requests.call(0)).toMatchObject({ url: '/api/notes', method: 'PATCH', body })
			expect(await result).toEqual({
				kind: 'ok',
				value: [
					{ id: 3, outcome: 'changed', note: { status: 'new', categoryId: 1 } },
					{ id: 1, outcome: 'not_found', note: null },
				],
			})
		})

		it('answers an unknown outcome as failed', async () => {
			const result = api.changeNotes([3], { status: 'archived' })

			requests
				.call(0)
				.respond(Response.json({ results: [{ id: 3, outcome: 'maybe', note: null }] }))

			expect(await result).toEqual({ kind: 'failed' })
		})
	})
})
