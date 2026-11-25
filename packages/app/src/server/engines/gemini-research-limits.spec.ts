// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { afterEach, beforeEach, describe, expect, it, jest } from 'bun:test'
import { reportCardFactory } from '#tests/factories/cards'
import quotaExceeded from '#tests/recordings/gemini/quota-exceeded.json'
import { errorOf } from '#tests/setup/engines'
import { recorded, suggestionSaying } from '#tests/setup/gemini'
import {
	after,
	blocked,
	geminiHarness,
	groundedSaying,
	ideaInput,
	instant,
	planSaying,
	play,
	promptOf,
	script,
	stuck,
	type GeminiHarness,
	type Script,
} from '#tests/setup/gemini-research'

import { redactPrivate } from './contract'

const input = redactPrivate(ideaInput())

/* A 3 s limit gives the plan 300 ms, a search step 600 ms and the report a reserve of 1 s, so that
 * a search starts only while the clock is at or before 1.4 s. */
const options = { tier: 'deep', timeoutMs: 3000 } as const

const questions = ['What exists?', 'How is it built?', 'What are the risks?']

const written = suggestionSaying(JSON.stringify(reportCardFactory.build({ uncertain: false })))

const notes = groundedSaying('Findings')

describe('Gemini research limits', () => {
	let harness: GeminiHarness

	/** Starts the research and plays the script's clock; resolves with the research's result. */
	async function research(steps: Script) {
		harness.answers.push(...steps.answers)

		const [result] = await Promise.all([harness.engine.research(input, options), play(steps)])

		return result
	}

	/** Like `research`, for a call that fails. */
	async function failure(steps: Script) {
		harness.answers.push(...steps.answers)

		const [error] = await Promise.all([
			errorOf(harness.engine.research(input, options)),
			play(steps),
		])

		return error
	}

	beforeEach(async () => {
		harness = await geminiHarness()
		jest.useFakeTimers({ now: new Date('2026-11-20T10:00:00Z') })
	})

	afterEach(() => {
		expect(jest.getTimerCount()).toBe(0)
		jest.useRealTimers()
	})

	describe('when a search step hangs past its cap', () => {
		let result: Awaited<ReturnType<typeof research>>

		beforeEach(async () => {
			const steps = script(
				instant(planSaying(questions)),
				instant(notes),
				stuck(600),
				instant(notes),
				instant(written),
			)

			result = await research(steps)
		})

		it('goes on and asks the report to name the question it did not answer', () => {
			const prompt = promptOf(harness.sent[4])

			expect(harness.sent).toHaveLength(5)
			expect(prompt).toContain('# Not researched')
			expect(prompt).toContain(`- ${questions[1]}`)
			expect(prompt).not.toContain(`- ${questions[0]}`)
		})

		it('marks the report uncertain even though the model said it was not', () => {
			expect(result.output).toMatchObject({ uncertain: true })
			expect(harness.runs()).toMatchObject([{ outcome: 'ok' }])
		})
	})

	it('starts no search once the reserve for the report is due, and still writes it', async () => {
		const five = [...questions, 'Who pays?', 'What is next?']

		const steps = script(
			instant(planSaying(five)),
			after(500, notes),
			after(500, notes),
			after(500, notes),
			instant(written),
		)

		await research(steps)

		const prompt = promptOf(harness.sent[4])

		expect(harness.sent).toHaveLength(5)
		expect(prompt).toContain('- Who pays?')
		expect(prompt).toContain('- What is next?')
		expect(harness.runs()).toMatchObject([{ outcome: 'ok' }])
	})

	it('fails with a timeout and writes nothing when no search is answered', async () => {
		const cutOff = suggestionSaying('{"cate', 'MAX_TOKENS')

		const steps = script(
			instant(planSaying(questions)),
			stuck(600),
			instant(blocked),
			instant(cutOff),
		)

		const error = await failure(steps)

		expect(error).toMatchObject({
			failure: { kind: 'timeout' },
			message: 'The idea research found nothing before its time limit',
		})
		expect(harness.sent).toHaveLength(4)
		expect(harness.runs()).toMatchObject([{ outcome: 'timeout' }])
	})

	it('fails with a timeout when the plan does not arrive within its share', async () => {
		const error = await failure(script(stuck(300)))

		expect(error).toMatchObject({ failure: { kind: 'timeout' } })
		expect(harness.sent).toHaveLength(1)
	})

	it('stops at a rate limit and sends nothing more', async () => {
		const limited = instant(recorded(quotaExceeded))
		const steps = script(instant(planSaying(questions)), instant(notes), limited)
		const error = await failure(steps)

		expect(error).toMatchObject({ failure: { kind: 'rate_limited' } })
		expect(harness.sent).toHaveLength(3)
		expect(harness.runs()).toMatchObject([{ outcome: 'rate_limited' }])
	})

	it("stops with the caller's reason when it aborts, and sends nothing after", async () => {
		const controller = new AbortController()
		const reason = new Error('Stopped by the caller')
		const steps = script(instant(planSaying(questions)), stuck(0), instant(notes))

		harness.answers.push(...steps.answers)

		const call = errorOf(harness.engine.research(input, { ...options, signal: controller.signal }))

		await steps.arrivals[1]
		controller.abort(reason)

		expect(await call).toBe(reason)
		expect(harness.sent).toHaveLength(2)
	})

	it('fails with a timeout when the whole limit passes while the report is written', async () => {
		const steps = script(
			instant(planSaying(questions)),
			instant(notes),
			instant(notes),
			instant(notes),
			stuck(3000),
		)

		const error = await failure(steps)

		expect(error).toMatchObject({ failure: { kind: 'timeout', afterMs: 3000 } })
		expect(harness.sent).toHaveLength(5)
		expect(harness.runs()).toMatchObject([{ outcome: 'timeout' }])
	})
})
