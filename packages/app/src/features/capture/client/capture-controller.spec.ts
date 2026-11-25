// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { drainMicrotasks } from 'bun:jsc'
import { afterEach, beforeEach, describe, expect, it, jest } from 'bun:test'
import {
	historyMatchFactory,
	savedNoteFactory,
	suggestAnswerFactory,
} from '#tests/factories/suggestions'

import { en } from '#/lib/i18n/en'

import { CaptureController } from './capture-controller.svelte'
import { suggestDebounceMs } from './suggestions'

interface FetchCall {
	readonly url: string
	readonly method: string | undefined
	readonly body: unknown
	readonly respond: (response: Response) => void
	readonly fail: (error: Error) => void
}

const categories = [
	{ id: 1, name: 'Technology', color: 'tech', icon: 'tech' },
	{ id: 2, name: 'Concept', color: 'concept', icon: 'concept' },
] as const

describe('CaptureController', () => {
	let calls: FetchCall[]
	let controller: CaptureController

	beforeEach(() => {
		jest.useFakeTimers()
		calls = []
		controller = new CaptureController({
			categories,
			strings: en.capture,
			fetch: async (url, init) => {
				const { promise, resolve, reject } = Promise.withResolvers<Response>()

				calls.push({
					url,
					method: init.method,
					body: init.body === undefined ? null : JSON.parse(init.body),
					respond: resolve,
					fail: reject,
				})

				return promise
			},
			signIn: () => {
				// No spec here is signed out.
			},
			isOnline: () => true,
		})
		controller.setOpen(true)
	})

	afterEach(() => {
		controller.destroy()
		jest.useRealTimers()
	})

	function call(index: number) {
		const found = calls.at(index)

		if (found === undefined) {
			throw new Error(`There is no request ${index}.`)
		}

		return found
	}

	/* Reopening and typing ask for suggestions too, so the save is found by its address. */
	function saveCall() {
		const found = calls.find(({ url }) => url === '/api/notes')

		if (found === undefined) {
			throw new Error('No save was sent.')
		}

		return found
	}

	async function answerSave() {
		saveCall().respond(Response.json(savedNoteFactory.build({ text: 'Alpha' }), { status: 201 }))
		drainMicrotasks()
	}

	function type(term: string) {
		controller.term = term
		controller.termChanged()
	}

	function toastTitles() {
		return controller.toasts.current?.title
	}

	function answerSuggest(index: number, categoryIds: number[]) {
		call(index).respond(Response.json(suggestAnswerFactory.build({ categories: categoryIds })))
		drainMicrotasks()
	}

	describe('when the term changes after an answer', () => {
		beforeEach(() => {
			const seen = historyMatchFactory.build({ term: 'Kafka', categoryId: 1, lastCard: null })

			type('Kafka')
			jest.advanceTimersByTime(suggestDebounceMs)
			call(0).respond(
				Response.json(suggestAnswerFactory.build({ categories: [2], history: [seen] })),
			)
			drainMicrotasks()
		})

		it('drops the old panel and pick at once', () => {
			expect(controller.panel).toBe('seen')

			type('Kafkaesque')

			expect(controller.panel).toBeNull()
			expect(controller.selection.categoryId).toBeNull()
			expect(controller.row.label).toBe('suggesting')
		})

		it('asks for the new term when the sheet reopens within the pause', () => {
			type('Kafkaesque')
			controller.setOpen(false)
			jest.advanceTimersByTime(suggestDebounceMs * 4)
			controller.setOpen(true)
			controller.differentMeaning()

			expect(calls.map(({ body }) => body)).toMatchObject([
				{ text: 'Kafka' },
				{ text: 'Kafkaesque' },
			])
			expect(controller.selection.categoryId).toBeNull()
		})

		it('keeps the answer and the pick when only spaces change', () => {
			controller.pickCategory(2)
			type('Kafka ')

			expect(controller.panel).toBe('seen')
			expect(controller.selection.categoryId).toBe(2)
			expect(calls).toHaveLength(1)
		})
	})

	describe('when a save answers', () => {
		beforeEach(() => {
			controller.term = 'Alpha'
			controller.contextField = 'a talk'
			controller.pickCategory(1)
		})

		it('closes and clears the sheet that still holds the draft', async () => {
			const saving = controller.submit('primary')

			await answerSave()
			await saving

			expect(controller).toMatchObject({ open: false, term: '', contextField: '' })
			expect(toastTitles()).toBe('Saved: Alpha')
		})

		it('keeps a new draft typed while the save was on its way', async () => {
			const saving = controller.submit('primary')

			controller.setOpen(false)
			controller.setOpen(true)
			type('Beta')
			controller.contextField = 'seen in a paper'
			await answerSave()
			await saving

			expect(controller).toMatchObject({
				open: true,
				term: 'Beta',
				contextField: 'seen in a paper',
			})
			expect(toastTitles()).toBe('Saved: Alpha')
		})
	})

	describe('when an answer arrives while a save is on its way', () => {
		beforeEach(() => {
			type('Kafka')
			jest.advanceTimersByTime(suggestDebounceMs)
			answerSuggest(0, [2])
			controller.isPrivate = true
			controller.privateChanged()
		})

		it('closes the sheet although the answer moved the automatic pick', async () => {
			const saving = controller.submit('primary')

			answerSuggest(1, [1])
			expect(controller.selection.categoryId).toBe(1)
			await answerSave()
			await saving

			expect(controller).toMatchObject({ open: false, term: '' })
			expect(toastTitles()).toBe('Saved: Kafka')
			expect(saveCall().body).toMatchObject({ categoryId: 2 })
		})

		it('keeps the sheet and the pick the owner made by hand during the save', async () => {
			const saving = controller.submit('primary')

			answerSuggest(1, [2])
			controller.pickCategory(1)
			await answerSave()
			await saving

			expect(controller).toMatchObject({ open: true, term: 'Kafka', isPrivate: true })
			expect(controller.selection).toMatchObject({ categoryId: 1, isUserPick: true })
		})

		it('closes the sheet when the owner picked by hand before the save', async () => {
			controller.pickCategory(2)

			const saving = controller.submit('primary')

			answerSuggest(1, [1])
			expect(controller.selection.categoryId).toBe(2)
			await answerSave()
			await saving

			expect(controller).toMatchObject({ open: false, term: '' })
		})
	})

	describe('when a save fails after the owner moved on', () => {
		const refusal = { error: { message: 'Invalid body', issues: ['text: Too long'] } }

		const failures: [string, (save: FetchCall) => void, string][] = [
			[
				'a server error',
				(save) => {
					save.respond(new Response(null, { status: 503 }))
				},
				en.capture.errorTitle,
			],
			[
				'a network error',
				(save) => {
					save.fail(new TypeError('Failed to fetch'))
				},
				en.capture.errorTitle,
			],
			[
				'a refusal',
				(save) => {
					save.respond(Response.json(refusal, { status: 400 }))
				},
				'Too long',
			],
		]

		it.each(failures)('names the lost draft after %s', async (_case, answer, detail) => {
			controller.term = 'Alpha'
			controller.pickCategory(1)

			const saving = controller.submit('primary')

			controller.setOpen(false)
			controller.setOpen(true)
			type('Beta')
			answer(saveCall())
			await saving

			expect(controller).toMatchObject({ open: true, term: 'Beta', error: null })
			expect(controller.toasts.current).toMatchObject({
				tone: 'error',
				title: 'Couldn’t save “Alpha”',
				detail,
			})
		})
	})

	describe('undo', () => {
		it('reports once when Undo is pressed twice', async () => {
			const titles: (string | undefined)[] = []
			const first = controller.undo(9)
			const second = controller.undo(9)

			await second
			titles.push(toastTitles())
			call(0).respond(new Response(null, { status: 204 }))
			await first
			titles.push(toastTitles())

			expect(titles).toEqual([undefined, 'Removed'])
			expect(calls).toHaveLength(1)
		})
	})
})
