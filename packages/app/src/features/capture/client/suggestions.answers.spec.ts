// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { drainMicrotasks } from 'bun:jsc'
import { afterEach, beforeEach, describe, expect, it, jest } from 'bun:test'
import { historyMatchFactory, suggestAnswerFactory } from '#tests/factories/suggestions'
import { SuggestionHarness } from '#tests/setup/suggestion-runner'

import { emptyAnswer, pendingRetryMs, suggestDebounceMs } from './suggestions'

describe('createSuggestionRunner answers', () => {
	let harness: SuggestionHarness

	beforeEach(() => {
		jest.useFakeTimers()
		harness = new SuggestionHarness()
	})

	afterEach(() => {
		harness.runner.stop()
		jest.useRealTimers()
	})

	describe('with a pending answer', () => {
		beforeEach(() => {
			harness.type('Kafka')
			jest.advanceTimersByTime(suggestDebounceMs)
			harness.call(0).respond(Response.json(suggestAnswerFactory.build({ pending: true })))
			drainMicrotasks()
		})

		it('keeps loading and asks again with the same body', () => {
			expect(harness.lastState()).toEqual({ kind: 'loading', text: 'Kafka' })

			jest.advanceTimersByTime(pendingRetryMs)
			expect(harness.calls.map(({ body }) => body)).toEqual([
				harness.call(0).body,
				harness.call(0).body,
			])
		})

		it('shows the answer a retry brings', () => {
			const answer = suggestAnswerFactory.build()

			jest.advanceTimersByTime(pendingRetryMs)
			harness.call(1).respond(Response.json(answer))
			drainMicrotasks()

			expect(harness.lastState()).toEqual({ kind: 'ready', text: 'Kafka', answer })
		})

		it('gives up after two retries and keeps only the history', () => {
			const history = historyMatchFactory.buildList(1, { lastCard: null })

			jest.advanceTimersByTime(pendingRetryMs)
			harness.call(1).respond(Response.json(suggestAnswerFactory.build({ pending: true })))
			drainMicrotasks()
			jest.advanceTimersByTime(pendingRetryMs)
			harness.call(2).respond(Response.json(suggestAnswerFactory.build({ pending: true, history })))
			drainMicrotasks()
			jest.advanceTimersByTime(pendingRetryMs * 2)

			expect(harness.calls).toHaveLength(3)
			expect(harness.lastState()).toEqual({
				kind: 'ready',
				text: 'Kafka',
				answer: { ...emptyAnswer, history },
			})
		})
	})

	describe('without a usable answer', () => {
		it('does not ask while offline and shows every category', () => {
			harness.online = false
			harness.type('Kafka')
			jest.advanceTimersByTime(suggestDebounceMs)

			expect(harness.calls).toHaveLength(0)
			expect(harness.lastState()).toEqual({ kind: 'ready', text: 'Kafka', answer: emptyAnswer })
		})

		it('shows the empty answer after a rejected fetch', () => {
			harness.type('Kafka')
			jest.advanceTimersByTime(suggestDebounceMs)
			harness.call(0).fail(new TypeError('Failed to fetch'))
			drainMicrotasks()

			expect(harness.lastState()).toEqual({ kind: 'ready', text: 'Kafka', answer: emptyAnswer })
		})

		it.each([
			['a server error', Response.json({ error: {} }, { status: 500 })],
			['an unparsable body', new Response('<html>')],
			['an unexpected shape', Response.json({ categories: 'x' })],
		])('shows the empty answer after %s', (_case, failure) => {
			harness.type('Kafka')
			jest.advanceTimersByTime(suggestDebounceMs)
			harness.call(0).respond(failure)
			drainMicrotasks()

			expect(harness.lastState()).toEqual({ kind: 'ready', text: 'Kafka', answer: emptyAnswer })
		})
	})

	describe('with history', () => {
		it.each([
			['the sense of the last card', { sense: 'a distributed log' }, 'a distributed log'],
			['no sense from a body without one', { format: 'concept' }, null],
		])('reads %s', (_case, body, sense) => {
			const answer = suggestAnswerFactory.build()
			const match = historyMatchFactory.build({ lastCard: { noteId: 4, sense } })

			harness.type('Kafka')
			jest.advanceTimersByTime(suggestDebounceMs)
			harness
				.call(0)
				.respond(
					Response.json({ ...answer, history: [{ ...match, lastCard: { noteId: 4, body } }] }),
				)
			drainMicrotasks()

			expect(harness.lastState()).toEqual({
				kind: 'ready',
				text: 'Kafka',
				answer: { ...answer, history: [match] },
			})
		})
	})
})
