// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { afterEach, beforeEach, describe, expect, it, jest, mock } from 'bun:test'
import { reportCardFactory, technologyCardFactory } from '#tests/factories/cards'
import { privateNoteFactory } from '#tests/factories/engine-input'
import suggestAnswer from '#tests/recordings/gemini/suggest.json'
import { errorOf } from '#tests/setup/engines'
import { recorded, recordedSuggestInput, suggestionSaying } from '#tests/setup/gemini'
import {
	after,
	geminiHarness,
	groundedSaying,
	ideaInput,
	instant,
	modelOf,
	planSaying,
	promptOf,
	script,
	type GeminiHarness,
	type Script,
} from '#tests/setup/gemini-research'

import {
	redactPrivate,
	type EngineResult,
	type ResearchProgress,
	type RunOptions,
} from './contract'
import { geminiSchema } from './gemini-schema'
import type { UsageCounters } from './gemini-usage'

const input = redactPrivate(ideaInput())

const options: RunOptions = { tier: 'deep', timeoutMs: 3000 }

const questions = ['What exists?', 'How is it built?', 'What are the risks?']

const written = suggestionSaying(JSON.stringify(reportCardFactory.build({ uncertain: false })))

const pages = [
	['https://a.example/', 'https://b.example/'],
	['https://b.example/', 'https://c.example/'],
	['https://c.example/'],
]

/** A plan of three questions, a search for each and the report, all answered at once. */
function threeSearches() {
	const searches = questions.map((question, index) =>
		instant(
			groundedSaying(`Findings about ${question}`, {
				queries: index + 1,
				pages: pages[index],
				suggestions: `<first-${index}>`,
			}),
		),
	)

	return script(instant(planSaying(questions)), ...searches, instant(written))
}

describe('Gemini research', () => {
	let harness: GeminiHarness

	beforeEach(() => {
		jest.useFakeTimers({ now: new Date('2026-11-20T10:00:00Z') })
	})

	afterEach(() => {
		expect(jest.getTimerCount()).toBe(0)
		jest.useRealTimers()
	})

	describe('with three planned questions', () => {
		let result: EngineResult<unknown>
		let progress: ResearchProgress[]

		beforeEach(async () => {
			harness = await geminiHarness()
			progress = []
			harness.answers.push(...threeSearches().answers)
			result = await harness.engine.research(input, {
				...options,
				onProgress: (step) => {
					progress.push(step)
				},
			})
		})

		it('sends the plan, a search for each question and the report, in that order', () => {
			const [plan, ...rest] = harness.sent
			const searches = rest.slice(0, 3)

			expect(harness.sent).toHaveLength(5)
			expect(plan.body).toMatchObject({
				generationConfig: { responseMimeType: 'application/json' },
			})
			expect(plan.body).not.toHaveProperty('tools')

			for (const search of searches) {
				expect(search.body).toMatchObject({ tools: [{ googleSearch: {} }, { urlContext: {} }] })
				expect(search.body).not.toHaveProperty('generationConfig.responseMimeType')
				expect(search.body).not.toHaveProperty('generationConfig.thinkingConfig')
			}

			expect(rest[3].body).toMatchObject({
				generationConfig: { responseJsonSchema: geminiSchema(input.output.jsonSchema) },
			})
			expect(rest[3].body).not.toHaveProperty('tools')
		})

		it('thinks hard when it plans and writes, on a Gemini 3 model', () => {
			const [plan] = harness.sent

			expect(plan.body).toMatchObject({
				generationConfig: { thinkingConfig: { thinkingLevel: 'HIGH' } },
			})
			expect(harness.sent[4].body).toMatchObject({
				generationConfig: { thinkingConfig: { thinkingLevel: 'HIGH' } },
			})
			expect(harness.sent[1].body).not.toHaveProperty('generationConfig.thinkingConfig')
		})

		it('writes the report from every finding and each page once', () => {
			const prompt = promptOf(harness.sent[4])

			for (const question of questions) {
				expect(prompt).toContain(`${question}\nFindings about ${question}`)
			}

			expect(prompt).toContain('take sources only from this list')
			expect(prompt.match(/https:\/\/b\.example\//gu)).toHaveLength(1)
			expect(prompt.match(/\n\d+\. [^\n]+: https:\/\/[^\n]+/gu)).toHaveLength(3)
			expect(prompt).not.toContain('# Not researched')
			expect(result.output).toMatchObject({ uncertain: false })
		})

		it('records one run with the sum of the searches and the first entry point', () => {
			expect(harness.runs()).toMatchObject([{ task: 'research', outcome: 'ok', searches: 6 }])
			expect(result.searchSuggestions).toBe('<first-0>')
		})

		it('tells where it is: planning, searching with growing pages, then writing', () => {
			expect(progress).toEqual([
				{ step: 'planning', questions: 0, searched: 0, pages: 0 },
				{ step: 'searching', questions: 3, searched: 0, pages: 0 },
				{ step: 'searching', questions: 3, searched: 1, pages: 2 },
				{ step: 'searching', questions: 3, searched: 2, pages: 3 },
				{ step: 'searching', questions: 3, searched: 3, pages: 3 },
				{ step: 'writing', questions: 3, searched: 3, pages: 3 },
			])
		})
	})

	it('adds no thinking config on Gemini 2.5, which thinks as much as it needs', async () => {
		harness = await geminiHarness({ model: 'gemini-2.5-flash' })
		harness.answers.push(...threeSearches().answers)
		await harness.engine.research(input, options)

		expect(harness.sent.map(({ text }) => text.includes('thinkingConfig'))).toEqual([
			false,
			false,
			false,
			false,
			false,
		])
	})

	it('is not failed by a progress callback that throws', async () => {
		harness = await geminiHarness()
		harness.answers.push(...threeSearches().answers)

		const onProgress = mock(() => {
			throw new Error('The board is gone')
		})

		const result = await harness.engine.research(input, { ...options, onProgress })

		expect(result.output).toMatchObject({ uncertain: false })
		expect(onProgress).toHaveBeenCalledTimes(6)
	})

	it('sends a private note as its term alone in every request', async () => {
		const note = privateNoteFactory.build()
		const earlier = technologyCardFactory.build()
		const hidden = redactPrivate({ ...ideaInput(), note, previous: [earlier] })

		harness = await geminiHarness()
		harness.answers.push(...threeSearches().answers)
		await harness.engine.research(hidden, options)

		expect(harness.sent).toHaveLength(5)

		for (const { text } of harness.sent) {
			expect(text).toContain(note.term)

			for (const secret of [note.text, note.context, note.url, earlier.summary]) {
				expect(text).not.toContain(secret ?? '')
			}
		}
	})

	describe('with a suggestion made during the research', () => {
		let research: Promise<unknown>
		let suggestion: Promise<unknown>
		let steps: Script

		beforeEach(async () => {
			harness = await geminiHarness()
			steps = script(
				instant(planSaying(questions)),
				after(100, groundedSaying('Notes')),
				instant(recorded(suggestAnswer)),
				instant(groundedSaying('Notes')),
				instant(groundedSaying('Notes')),
				instant(written),
			)
			harness.answers.push(...steps.answers)
			research = harness.engine.research(input, options)

			await steps.arrivals[1]
			suggestion = harness.engine.suggest(recordedSuggestInput(), { tier: 'fast', timeoutMs: 3000 })
			jest.advanceTimersByTime(100)
			await Promise.all([research, suggestion])
		})

		it('runs between two research requests, one request at a time', () => {
			expect(harness.sent.map((request) => modelOf(request))).toEqual([
				'gemini-3.8-flash',
				'gemini-3.8-flash',
				'gemini-3.1-flash-lite',
				'gemini-3.8-flash',
				'gemini-3.8-flash',
				'gemini-3.8-flash',
			])
		})
	})

	describe('with the usage counters', () => {
		it('counts seven requests for the call', async () => {
			const take = mock<UsageCounters['take']>()

			harness = await geminiHarness({ counters: { take } })
			harness.answers.push(...threeSearches().answers)
			await harness.engine.research(input, options)

			expect(take).toHaveBeenCalledWith('gemini-3.8-flash', expect.anything(), 7)
		})

		it('refuses a call that cannot fit a daily limit of six, before any request', async () => {
			harness = await geminiHarness({ limit: { perMinute: null, perDay: 6 } })

			const error = await errorOf(harness.engine.research(input, options))

			expect(error.message).toContain('never fits the configured limit of 6')
			expect(harness.sent).toHaveLength(0)
			expect(harness.runs()).toMatchObject([{ outcome: 'error' }])
		})
	})
})
