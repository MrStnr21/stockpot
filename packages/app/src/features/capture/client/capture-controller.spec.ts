// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { afterEach, beforeEach, describe, expect, it, jest } from 'bun:test'
import { historyMatchFactory } from '#tests/factories/suggestions'
import { CaptureHarness } from '#tests/setup/capture-controller'

import { suggestDebounceMs } from './suggestions'

describe('CaptureController', () => {
	let harness: CaptureHarness

	beforeEach(() => {
		jest.useFakeTimers()
		harness = new CaptureHarness()
	})

	afterEach(() => {
		harness.controller.destroy()
		jest.useRealTimers()
	})

	describe('when the term changes after an answer', () => {
		beforeEach(() => {
			const seen = historyMatchFactory.build({ term: 'Kafka', categoryId: 1, lastCard: null })

			harness.type('Kafka')
			jest.advanceTimersByTime(suggestDebounceMs)
			harness.answerSuggest(0, { categories: [2], history: [seen] })
		})

		it('drops the old panel and pick at once', () => {
			expect(harness.controller.panel).toBe('seen')

			harness.type('Kafkaesque')

			expect(harness.controller.panel).toBeNull()
			expect(harness.controller.selection.categoryId).toBeNull()
			expect(harness.controller.row.label).toBe('suggesting')
		})

		it('asks for the new term when the sheet reopens within the pause', () => {
			harness.type('Kafkaesque')
			harness.controller.setOpen(false)
			jest.advanceTimersByTime(suggestDebounceMs * 4)
			harness.controller.setOpen(true)
			harness.controller.differentMeaning()

			expect(harness.calls.map(({ body }) => body)).toMatchObject([
				{ text: 'Kafka' },
				{ text: 'Kafkaesque' },
			])
			expect(harness.controller.selection.categoryId).toBeNull()
		})

		it('keeps the answer and the pick when only spaces change', () => {
			harness.controller.pickCategory(2)
			harness.type('Kafka ')

			expect(harness.controller.panel).toBe('seen')
			expect(harness.controller.selection.categoryId).toBe(2)
			expect(harness.calls).toHaveLength(1)
		})
	})

	describe('when a save answers', () => {
		beforeEach(() => {
			harness.controller.term = 'Alpha'
			harness.controller.contextField = 'a talk'
			harness.controller.pickCategory(1)
		})

		it('closes and clears the sheet that still holds the draft', async () => {
			const saving = harness.controller.submit('primary')

			harness.answerSave()
			await saving

			expect(harness.controller).toMatchObject({ open: false, term: '', contextField: '' })
			expect(harness.toastTitle()).toBe('Saved: Alpha')
		})

		it('keeps a new draft typed while the save was on its way', async () => {
			const saving = harness.controller.submit('primary')

			harness.controller.setOpen(false)
			harness.controller.setOpen(true)
			harness.type('Beta')
			harness.controller.contextField = 'seen in a paper'
			harness.answerSave()
			await saving

			expect(harness.controller).toMatchObject({
				open: true,
				term: 'Beta',
				contextField: 'seen in a paper',
			})
			expect(harness.toastTitle()).toBe('Saved: Alpha')
		})
	})

	describe('undo', () => {
		it('reports once when Undo is pressed twice', async () => {
			const titles: (string | undefined)[] = []
			const first = harness.controller.undo(9)
			const second = harness.controller.undo(9)

			await second
			titles.push(harness.toastTitle())
			harness.call(0).respond(new Response(null, { status: 204 }))
			await first
			titles.push(harness.toastTitle())

			expect(titles).toEqual([undefined, 'Removed'])
			expect(harness.calls).toHaveLength(1)
		})
	})
})
