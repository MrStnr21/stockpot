// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { drainMicrotasks } from 'bun:jsc'
import { afterEach, beforeEach, describe, expect, it, jest } from 'bun:test'
import { faker } from '@faker-js/faker'
import { suggestAnswerFactory } from '#tests/factories/suggestions'
import { SuggestionHarness } from '#tests/setup/suggestion-runner'

import { pendingRetryMs, suggestDebounceMs } from './suggestions'

describe('createSuggestionRunner', () => {
	let harness: SuggestionHarness

	beforeEach(() => {
		jest.useFakeTimers()
		harness = new SuggestionHarness()
	})

	afterEach(() => {
		harness.runner.stop()
		jest.useRealTimers()
	})

	describe('while the owner types', () => {
		it('asks once, after a pause, with the latest text', () => {
			harness.type('K')
			jest.advanceTimersByTime(200)
			harness.type('Kaf')
			jest.advanceTimersByTime(200)
			harness.type('Kafka')
			jest.advanceTimersByTime(suggestDebounceMs - 1)
			expect(harness.calls).toHaveLength(0)

			jest.advanceTimersByTime(1)
			expect(harness.calls).toMatchObject([
				{
					url: '/api/suggest',
					body: { text: 'Kafka', context: null, url: null, private: false },
				},
			])
			expect(harness.lastState()).toEqual({ kind: 'loading', text: 'Kafka' })
		})

		it('sends the context field as it is when the request leaves, split into context and URL', () => {
			const link = faker.internet.url()

			harness.type('Kafka')
			harness.edit({ contextField: `a talk ${link}` })
			jest.advanceTimersByTime(suggestDebounceMs)

			expect(harness.call(0).body).toEqual({
				text: 'Kafka',
				context: 'a talk',
				url: link,
				private: false,
			})
		})

		it('does not ask for an empty term and resets to the empty state', () => {
			harness.type('Kafka')
			harness.type('   ')
			jest.advanceTimersByTime(suggestDebounceMs * 2)

			expect(harness.calls).toHaveLength(0)
			expect(harness.lastState()).toEqual({ kind: 'empty' })
		})

		it('shows the answer for the term it was asked for', () => {
			const answer = suggestAnswerFactory.build()

			harness.type('Kafka')
			jest.advanceTimersByTime(suggestDebounceMs)
			harness.call(0).respond(Response.json(answer))
			drainMicrotasks()

			expect(harness.lastState()).toEqual({ kind: 'ready', text: 'Kafka', answer })
		})
	})

	describe('with answers out of order', () => {
		it('aborts and drops the answer for an older term once the term changes', () => {
			harness.type('Kaf')
			jest.advanceTimersByTime(suggestDebounceMs)
			harness.type('Kafka')

			expect(harness.call(0).signal?.aborted).toBe(true)

			harness.call(0).respond(Response.json(suggestAnswerFactory.build()))
			drainMicrotasks()
			expect(harness.states.filter((state) => state.kind === 'ready')).toEqual([])

			const answer = suggestAnswerFactory.build()

			jest.advanceTimersByTime(suggestDebounceMs)
			harness.call(1).respond(Response.json(answer))
			drainMicrotasks()
			expect(harness.lastState()).toEqual({ kind: 'ready', text: 'Kafka', answer })
		})

		it('drops an answer that arrives after a newer request started', () => {
			const older = suggestAnswerFactory.build()
			const newer = suggestAnswerFactory.build()

			harness.edit({ text: 'Kafka' })
			harness.runner.askNow()
			harness.edit({ private: true })
			harness.runner.askNow()

			harness.call(1).respond(Response.json(newer))
			drainMicrotasks()
			harness.call(0).respond(Response.json(older))
			drainMicrotasks()

			expect(harness.states.filter((state) => state.kind === 'ready')).toEqual([
				{ kind: 'ready', text: 'Kafka', answer: newer },
			])
		})

		it('drops a pending retry once the term changes', () => {
			harness.type('Kaf')
			jest.advanceTimersByTime(suggestDebounceMs)
			harness.call(0).respond(Response.json(suggestAnswerFactory.build({ pending: true })))
			drainMicrotasks()
			harness.type('Kafka')
			jest.advanceTimersByTime(pendingRetryMs * 2)

			expect(harness.calls.map(({ body }) => body)).toMatchObject([
				{ text: 'Kaf' },
				{ text: 'Kafka' },
			])
		})
	})

	describe('when the sheet closes', () => {
		it('aborts the request in flight and ignores its answer', () => {
			harness.type('Kafka')
			jest.advanceTimersByTime(suggestDebounceMs)
			harness.runner.stop()

			expect(harness.call(0).signal?.aborted).toBe(true)

			harness.call(0).respond(Response.json(suggestAnswerFactory.build()))
			drainMicrotasks()
			expect(harness.lastState()).toEqual({ kind: 'loading', text: 'Kafka' })
		})

		it('clears the pause timer', () => {
			harness.type('Kafka')
			harness.runner.stop()
			jest.advanceTimersByTime(suggestDebounceMs)

			expect(harness.calls).toHaveLength(0)
		})
	})

	describe('when Private is toggled', () => {
		it('asks at once with private set', () => {
			harness.type('Kafka')
			harness.edit({ private: true })
			harness.runner.askNow()

			expect(harness.calls).toMatchObject([{ body: { text: 'Kafka', private: true } }])
			jest.advanceTimersByTime(suggestDebounceMs)
			expect(harness.calls).toHaveLength(1)
		})
	})
})
