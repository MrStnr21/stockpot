// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { afterEach, beforeEach, describe, expect, it, jest, mock, spyOn, type Mock } from 'bun:test'
import { faker } from '@faker-js/faker'
import { categoryRowFactory } from '#tests/factories/categories'
import { noteRowFactory } from '#tests/factories/notes'
import { configuredSettingsFactory } from '#tests/factories/settings'
import { termRowFactory } from '#tests/factories/terms'
import { createTestDb, type TestDb } from '#tests/setup/db'
import { eq } from 'drizzle-orm'
import type * as v from 'valibot'

import { formatHints } from '#/lib/format-ids'
import { categories } from '#/server/db/schema/notes'
import { EngineError, parseOutput, type SuggestInput } from '#/server/engines/contract'
import { log } from '#/server/log'

import { createSuggester, suggestionWaitMs, type Suggester, type SuggestRequest } from './suggest'

const settings = configuredSettingsFactory.build()

const { term } = termRowFactory.build()

const { text, context } = noteRowFactory.build({ text: `  ${term.toUpperCase()}!  ` })

const request = { text, context: context ?? null, url: faker.internet.url(), isPrivate: false }

const empty = {
	categories: [],
	senses: [],
	language: null,
	source: 'none' as const,
	pending: false,
}

const meaning = faker.lorem.words(3)

const otherMeaning = faker.lorem.words(4)

describe('createSuggester', () => {
	let db: TestDb
	let category: typeof categories.$inferSelect
	let second: typeof categories.$inferSelect
	let service: Suggester
	let calls: Mock<typeof reply>

	async function reply<TSchema extends v.GenericSchema>(input: SuggestInput<TSchema>) {
		const id = String(category.id)
		const other = String(second.id)

		const output = parseOutput(input.output, {
			categories: [id, other, id],
			senses: [
				{ sense: meaning, category: id },
				{ sense: otherMeaning, category: other },
			],
			language: 'en',
		})

		return { output, engine: 'gemini', model: null, searchSuggestions: null, elapsedMs: 0 }
	}

	const router = { suggest: reply }

	async function suggest(note = request, history: SuggestRequest['history'] = []) {
		return service.suggest(db, { note, history, language: settings.cardLanguage })
	}

	beforeEach(async () => {
		;({ db } = await createTestDb())
		const rows = categoryRowFactory.transient({ db })
		category = await rows.create({
			format: 'comparison',
			position: -2,
			instructions: faker.lorem.sentence(),
		})
		second = await rows.create({ format: faker.string.uuid(), position: -1 })
		calls = spyOn(router, 'suggest')
		service = createSuggester({ router })
	})

	afterEach(() => {
		mock.restore()
	})

	it('keeps the wait below the server latency budget', () => {
		expect(suggestionWaitMs).toBeLessThan(1500)
	})

	it('prefers current history to a cached engine answer and keeps the first category for each meaning', async () => {
		await suggest()
		calls.mockClear()
		const first = { categoryId: category.id, meaning }
		const next = { categoryId: second.id, meaning: otherMeaning }
		expect(await suggest(request, [first, { ...next, meaning }, next, first])).toEqual({
			categories: [category.id, second.id],
			senses: [
				{ sense: meaning, categoryId: category.id },
				{ sense: otherMeaning, categoryId: second.id },
			],
			language: null,
			source: 'history',
			pending: false,
		})
		expect(calls).not.toHaveBeenCalled()
	})

	it('omits sense options when history has only one distinct meaning', async () => {
		const hit = { categoryId: category.id, meaning }
		expect(await suggest(request, [hit, hit, { ...hit, meaning: '' }])).toMatchObject({
			categories: [category.id],
			senses: [],
			source: 'history',
		})
		expect(calls).not.toHaveBeenCalled()
	})

	it('returns up to three history categories and four senses in history order', async () => {
		const rows = await categoryRowFactory.transient({ db }).createList(5)
		const hits = rows.map(({ id, name }) => ({ categoryId: id, meaning: name }))
		expect(await suggest(request, hits)).toMatchObject({
			categories: rows.slice(0, 3).map(({ id }) => id),
			senses: rows.slice(0, 4).map(({ name, id }) => ({ sense: name, categoryId: id })),
		})
		expect(calls).not.toHaveBeenCalled()
	})

	it('asks the engine when the history category was deleted', async () => {
		expect(await suggest(request, [{ categoryId: null, meaning }])).toEqual({
			categories: [category.id, second.id],
			senses: [
				{ sense: meaning, categoryId: category.id },
				{ sense: otherMeaning, categoryId: second.id },
			],
			language: 'en',
			source: 'engine',
			pending: false,
		})
		expect(calls).toHaveBeenCalledTimes(1)
	})

	it('sends the trimmed note, card language and category hints in display order', async () => {
		await suggest()
		const input = calls.mock.calls[0]?.[0]
		expect(input).toMatchObject({
			language: settings.cardLanguage,
			note: { ...request, text: text.trim(), term },
		})
		expect(input.categories.slice(0, 2)).toEqual([
			{ id: String(category.id), name: category.name, hint: formatHints.comparison },
			{ id: String(second.id), name: second.name, hint: null },
		])
	})

	it('coalesces concurrent requests and reuses their answer on a later request', async () => {
		const [first, secondAnswer] = await Promise.all([suggest(), suggest()])
		expect(await suggest()).toEqual(first)
		expect(secondAnswer).toEqual(first)
		expect(calls).toHaveBeenCalledTimes(1)
	})

	it.each([
		[false, 2],
		[true, 1],
	] as const)('keys changes to context for private=%p in %i calls', async (isPrivate, count) => {
		await suggest({ ...request, isPrivate })
		await suggest({ ...request, isPrivate, context: faker.lorem.paragraph() })
		expect(calls).toHaveBeenCalledTimes(count)
	})

	it('makes a new call after a category is renamed or the language changes', async () => {
		await suggest()
		db.update(categories)
			.set({ name: categoryRowFactory.build().name })
			.where(eq(categories.id, category.id))
			.run()
		await suggest()
		await service.suggest(db, { note: request, history: [], language: 'fr' })
		expect(calls).toHaveBeenCalledTimes(3)
	})

	it('answers empty without calling the engine for unnormalizable text or no categories', async () => {
		expect(await suggest({ ...request, text: '…' })).toEqual(empty)
		db.delete(categories).run()
		expect(await suggest()).toEqual(empty)
		expect(calls).not.toHaveBeenCalled()
	})

	describe('while the engine call is in flight', () => {
		let gate: PromiseWithResolvers<null>
		beforeEach(() => {
			jest.useFakeTimers()
			gate = Promise.withResolvers<null>()
			calls.mockImplementationOnce(async (input) => {
				await gate.promise

				return reply(input)
			})
			service = createSuggester({ router, waitMs: 5, callLimitMs: 8 })
		})

		afterEach(() => {
			jest.useRealTimers()
		})

		it.each([false, true])('drops deleted categories and senses (reuse=%p)', async (reuse) => {
			const answer = suggest()
			db.delete(categories).where(eq(categories.id, second.id)).run()

			if (reuse) {
				const replacement = await categoryRowFactory.transient({ db }).create()
				expect(replacement.id).toBe(second.id)
				expect(replacement.name).not.toBe(second.name)
			}

			gate.resolve(null)
			expect(await answer).toMatchObject({
				categories: [category.id],
				senses: [{ sense: meaning, categoryId: category.id }],
			})
		})

		it('returns pending and serves the completed call on the next request', async () => {
			const answer = suggest()
			jest.advanceTimersByTime(5)
			expect(await answer).toEqual({ ...empty, pending: true })
			gate.resolve(null)
			await calls.mock.results[0]?.value
			expect(await suggest()).toMatchObject({
				categories: [category.id, second.id],
				source: 'engine',
				pending: false,
			})
			expect(calls).toHaveBeenCalledTimes(1)
		})

		it('drops a call that never settles at its deadline and retries the same request', async () => {
			const first = suggest()
			jest.advanceTimersByTime(5)
			expect(await first).toEqual({ ...empty, pending: true })
			const waiting = suggest()
			jest.advanceTimersByTime(3)
			expect(await waiting).toEqual(empty)
			expect(await suggest()).toMatchObject({ source: 'engine', pending: false })
			expect(calls).toHaveBeenCalledTimes(2)
		})
	})

	describe('when the call fails', () => {
		beforeEach(() => {
			spyOn(log, 'warn').mockImplementation(() => {
				// Keep the expected failures out of the test log.
			})
		})

		it('silently drops expected failures and retries on the next request', async () => {
			calls.mockRejectedValueOnce(new EngineError({ kind: 'auth' }, 'Unavailable'))
			expect(await suggest()).toEqual(empty)
			expect(await suggest()).toMatchObject({ source: 'engine' })
			expect(calls).toHaveBeenCalledTimes(2)
			expect(log.warn).not.toHaveBeenCalled()
		})

		it('warns once for a shared unexpected failure', async () => {
			calls.mockRejectedValueOnce(new Error('Connection closed'))
			expect(await Promise.all([suggest(), suggest()])).toEqual([empty, empty])
			expect(log.warn).toHaveBeenCalledTimes(1)
			expect(log.warn).toHaveBeenCalledWith('Category suggestion failed', { name: 'Error' })
		})

		it('preserves a newer call for the same key when an evicted call fails', async () => {
			const gate = Promise.withResolvers<never>()
			calls.mockReturnValueOnce(gate.promise)
			service = createSuggester({ router, cacheSize: 1 })
			const evicted = suggest()
			await suggest({ ...request, context: null })
			await suggest()
			gate.reject(new Error('Connection closed'))
			expect(await evicted).toEqual(empty)
			expect(await suggest()).toMatchObject({ source: 'engine' })
			expect(calls).toHaveBeenCalledTimes(3)
		})
	})

	it('evicts the least recently used key when a third key needs room', async () => {
		service = createSuggester({ router, cacheSize: 2 })
		const older = { ...request, url: faker.internet.url() }
		await suggest()
		await suggest(older)
		await suggest()
		await suggest({ ...request, context: null })
		await suggest()
		expect(calls).toHaveBeenCalledTimes(3)
		await suggest(older)
		expect(calls).toHaveBeenCalledTimes(4)
	})
})
