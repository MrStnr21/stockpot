// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { beforeEach, describe, expect, it, mock } from 'bun:test'
import { faker } from '@faker-js/faker'
import { savedNoteFactory } from '#tests/factories/suggestions'

import { createCaptureApi, type CaptureApi, type CaptureDraft } from './capture-api'

interface FetchCall {
	readonly url: string
	readonly method: string | undefined
	readonly body: unknown
}

type Answer = Response | Error | Promise<Response>

describe('createCaptureApi', () => {
	let calls: FetchCall[]
	let answers: Answer[]
	let api: CaptureApi
	let draft: CaptureDraft
	let link: string

	beforeEach(() => {
		calls = []
		answers = []
		link = faker.internet.url()
		draft = {
			text: '  Kafka ',
			contextField: `a talk ${link}`,
			categoryId: faker.number.int({ min: 1, max: 6 }),
			private: false,
		}
		api = createCaptureApi({
			fetch: mock(async (url: string, init: RequestInit & { readonly body?: string }) => {
				calls.push({
					url,
					method: init.method,
					body: init.body === undefined ? null : JSON.parse(init.body),
				})

				const answer = answers.shift() ?? new Response(null, { status: 500 })

				if (answer instanceof Error) {
					throw answer
				}

				return answer
			}),
		})
	})

	function answerWith(...next: Answer[]) {
		answers.push(...next)
	}

	describe('submit', () => {
		it('posts the note with the context split into context and URL', async () => {
			const note = savedNoteFactory.build()

			answerWith(Response.json(note, { status: 201 }))
			await api.submit({ mode: 'save', draft })

			expect(calls).toEqual([
				{
					url: '/api/notes',
					method: 'POST',
					body: {
						text: 'Kafka',
						context: 'a talk',
						url: link,
						categoryId: draft.categoryId,
						private: false,
						source: 'web',
					},
				},
			])
		})

		it('sends private as set', async () => {
			answerWith(Response.json(savedNoteFactory.build({ private: true }), { status: 201 }))
			await api.submit({ mode: 'save', draft: { ...draft, private: true } })

			expect(calls[0]?.body).toMatchObject({ private: true })
		})

		it.each([
			['a new note can be undone', 201, true],
			['a note merged into the saved one cannot', 200, false],
		])('reports that %s', async (_case, status, canUndo) => {
			const note = savedNoteFactory.build()

			answerWith(Response.json(note, { status }))

			expect(await api.submit({ mode: 'save', draft })).toEqual({
				kind: 'saved',
				note,
				canUndo,
				followUp: null,
			})
		})

		it('starts research on the saved note after the save', async () => {
			const note = savedNoteFactory.build()

			answerWith(Response.json(note, { status: 201 }), Response.json({}, { status: 202 }))

			const result = await api.submit({ mode: 'research', draft })

			expect(result.kind === 'saved' && (await result.followUp)).toBe(true)
			expect(calls.map(({ url, body }) => ({ url, body }))).toMatchObject([
				{ url: '/api/notes' },
				{ url: `/api/notes/${note.id}/research`, body: {} },
			])
		})

		it('asks for the next level of the card shown before', async () => {
			const note = savedNoteFactory.build()
			const deeperNoteId = note.id + 1

			answerWith(Response.json(note, { status: 201 }), Response.json({}, { status: 200 }))

			const result = await api.submit({ mode: 'deeper', draft, deeperNoteId })

			expect(result.kind === 'saved' && (await result.followUp)).toBe(true)
			expect(calls[1]).toEqual({
				url: `/api/notes/${deeperNoteId}/deeper`,
				method: 'POST',
				body: { now: true },
			})
		})

		it('researches the new note when there is nothing to go deeper from', async () => {
			const note = savedNoteFactory.build()

			answerWith(Response.json(note, { status: 201 }), Response.json({}, { status: 202 }))
			await api.submit({ mode: 'deeper', draft, deeperNoteId: null })

			expect(calls[1]?.url).toBe(`/api/notes/${note.id}/research`)
		})

		it.each([
			['an error answer', Response.json({ error: {} }, { status: 409 })],
			['a network error', new TypeError('Failed to fetch')],
		])('reports a follow-up that failed with %s apart from the save', async (_case, failure) => {
			const note = savedNoteFactory.build()

			answerWith(Response.json(note, { status: 201 }), failure)

			const result = await api.submit({ mode: 'research', draft })

			expect(result).toMatchObject({ kind: 'saved', note, canUndo: true })
			expect(result.kind === 'saved' && (await result.followUp)).toBe(false)
		})

		it('shows the first issue of a rejected body without its field path', async () => {
			answerWith(
				Response.json(
					{
						error: {
							code: 'invalid_body',
							message: 'The body does not match what this route accepts.',
							issues: ['text: Use at most 1000 characters.', 'url: Use an http or https URL.'],
						},
					},
					{ status: 400 },
				),
			)

			expect(await api.submit({ mode: 'save', draft })).toEqual({
				kind: 'invalid',
				message: 'Use at most 1000 characters.',
			})
		})

		it('shows the error message of a rejected body without issues', async () => {
			answerWith(
				Response.json(
					{ error: { code: 'invalid_json', message: 'The body is not valid JSON.' } },
					{ status: 400 },
				),
			)

			expect(await api.submit({ mode: 'save', draft })).toEqual({
				kind: 'invalid',
				message: 'The body is not valid JSON.',
			})
		})

		it('reports a signed-out owner', async () => {
			answerWith(Response.json({ error: {} }, { status: 401 }))

			expect(await api.submit({ mode: 'research', draft })).toEqual({ kind: 'unauthorized' })
			expect(calls).toHaveLength(1)
		})

		it.each([
			['a network error', new TypeError('Failed to fetch')],
			['a server error', Response.json({ error: {} }, { status: 503 })],
			['an unexpected body', Response.json({ id: 'x' }, { status: 201 })],
		])('reports a failed save after %s without a follow-up', async (_case, failure) => {
			answerWith(failure)

			expect(await api.submit({ mode: 'research', draft })).toEqual({ kind: 'failed' })
			expect(calls).toHaveLength(1)
		})

		it('refuses a second submit while the first is saving, then accepts the next', async () => {
			const { promise, resolve } = Promise.withResolvers<Response>()
			const note = savedNoteFactory.build()

			answerWith(promise)

			const first = api.submit({ mode: 'save', draft })

			expect(api.isSaving).toBe(true)
			expect(await api.submit({ mode: 'research', draft })).toEqual({ kind: 'busy' })

			resolve(Response.json(note, { status: 201 }))
			expect(await first).toMatchObject({ kind: 'saved', note })
			expect(api.isSaving).toBe(false)

			answerWith(new TypeError('Failed to fetch'))
			expect(await api.submit({ mode: 'save', draft })).toEqual({ kind: 'failed' })
			expect(calls).toHaveLength(2)
		})
	})

	describe('undo', () => {
		it('deletes the note', async () => {
			answerWith(new Response(null, { status: 204 }))

			expect(await api.undo(7)).toBe('removed')
			expect(calls).toEqual([{ url: '/api/notes/7', method: 'DELETE', body: null }])
		})

		it('reports a failed delete', async () => {
			answerWith(new TypeError('Failed to fetch'))

			expect(await api.undo(7)).toBe('failed')
		})

		it('sends one delete when Undo is pressed twice', async () => {
			const { promise, resolve } = Promise.withResolvers<Response>()

			answerWith(promise)

			const first = api.undo(7)

			expect(await api.undo(7)).toBe('busy')
			resolve(new Response(null, { status: 204 }))
			expect(await first).toBe('removed')
			expect(calls).toHaveLength(1)
		})
	})
})
