// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { afterEach, beforeEach, describe, expect, it, jest } from 'bun:test'
import { suggestSenseFactory } from '#tests/factories/suggestions'
import { CaptureHarness, type CaptureFetchCall } from '#tests/setup/capture-controller'

import { en } from '#/lib/i18n/en'

import { suggestDebounceMs } from './suggestions'

describe('CaptureController settling a save', () => {
	let harness: CaptureHarness

	beforeEach(() => {
		jest.useFakeTimers()
		harness = new CaptureHarness()
	})

	afterEach(() => {
		harness.controller.destroy()
		jest.useRealTimers()
	})

	describe('when the pick changes while the save is on its way', () => {
		beforeEach(() => {
			harness.type('Kafka')
			jest.advanceTimersByTime(suggestDebounceMs)
			harness.answerSuggest(0, { categories: [2] })
			harness.controller.isPrivate = true
			harness.controller.privateChanged()
		})

		it('closes the sheet although an answer moved the automatic pick', async () => {
			const saving = harness.controller.submit('primary')

			harness.answerSuggest(1, { categories: [1] })
			expect(harness.controller.selection.categoryId).toBe(1)
			harness.answerSave()
			await saving

			expect(harness.controller).toMatchObject({ open: false, term: '' })
			expect(harness.toastTitle()).toBe('Saved: Kafka')
			expect(harness.saveCall().body).toMatchObject({ categoryId: 2 })
		})

		it('closes the sheet although the owner picked another category by hand', async () => {
			const saving = harness.controller.submit('primary')

			harness.answerSuggest(1, { categories: [2] })
			harness.controller.pickCategory(1)
			harness.answerSave()
			await saving

			expect(harness.controller).toMatchObject({ open: false, term: '' })
		})

		it('keeps a hand pick made before the save against a later answer', async () => {
			harness.controller.pickCategory(2)

			const saving = harness.controller.submit('primary')

			harness.answerSuggest(1, { categories: [1] })
			expect(harness.controller.selection.categoryId).toBe(2)
			harness.answerSave()
			await saving

			expect(harness.controller).toMatchObject({ open: false, term: '' })
		})
	})

	describe('when the owner edits while the save is on its way', () => {
		beforeEach(() => {
			harness.type('Alpha')
			jest.advanceTimersByTime(suggestDebounceMs)
		})

		it('closes the sheet after a term typed and then undone', async () => {
			harness.answerSuggest(0, { categories: [2] })

			const saving = harness.controller.submit('primary')

			harness.type('Alph')
			harness.type('Alpha')
			harness.answerSave()
			await saving

			expect(harness.controller).toMatchObject({ open: false, term: '' })
		})

		it('closes the sheet after a trailing space', async () => {
			harness.answerSuggest(0, { categories: [2] })

			const saving = harness.controller.submit('primary')

			harness.type('Alpha ')
			harness.answerSave()
			await saving

			expect(harness.controller).toMatchObject({ open: false, term: '' })
		})

		it('closes the sheet after a meaning dismissed for the suggested category', async () => {
			const senses = [
				suggestSenseFactory.build({ categoryId: 1 }),
				suggestSenseFactory.build({ categoryId: 2 }),
			]

			harness.answerSuggest(0, { categories: [1], senses })
			harness.controller.pickSense(1)

			const saving = harness.controller.submit('primary')

			harness.controller.noneOfThese()
			expect(harness.controller.selection.categoryId).toBe(1)
			harness.answerSave()
			await saving

			expect(harness.controller).toMatchObject({ open: false, term: '' })
			expect(harness.saveCall().body).toMatchObject({ categoryId: 2 })
		})
	})

	describe('when a save fails after the owner moved on', () => {
		const refusal = { error: { message: 'Invalid body', issues: ['text: Too long'] } }

		const failures: [string, (save: CaptureFetchCall) => void, string][] = [
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
			harness.controller.term = 'Alpha'
			harness.controller.pickCategory(1)

			const saving = harness.controller.submit('primary')

			harness.controller.setOpen(false)
			harness.controller.setOpen(true)
			harness.type('Beta')
			answer(harness.saveCall())
			await saving

			expect(harness.controller).toMatchObject({ open: true, term: 'Beta', error: null })
			expect(harness.controller.toasts.current).toMatchObject({
				tone: 'error',
				title: 'Couldn’t save “Alpha”',
				detail,
			})
		})
	})

	describe('when a save fails after the sheet was closed', () => {
		it('reports it once in a toast and keeps the draft for reopening', async () => {
			harness.controller.term = 'Alpha'
			harness.controller.pickCategory(1)

			const saving = harness.controller.submit('primary')

			harness.controller.setOpen(false)
			harness.saveCall().respond(new Response(null, { status: 500 }))
			await saving

			expect(harness.controller).toMatchObject({ open: false, term: 'Alpha', error: null })
			expect(harness.controller.toasts.current).toMatchObject({
				tone: 'error',
				title: 'Couldn’t save “Alpha”',
			})

			harness.controller.setOpen(true)

			expect(harness.controller).toMatchObject({ open: true, term: 'Alpha', error: null })
			expect(harness.controller.selection.categoryId).toBe(1)
		})
	})
})
