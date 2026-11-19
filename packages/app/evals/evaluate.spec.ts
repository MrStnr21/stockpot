// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { beforeEach, describe, expect, it } from 'bun:test'
import { briefCardFactory, technologyCardFactory } from '#tests/factories/cards'
import {
	evalNoteFactory,
	privateEvalNoteFactory,
	unknowableEvalNoteFactory,
} from '#tests/factories/eval-notes'
import type * as v from 'valibot'

import {
	EngineError,
	parseOutput,
	type Engine,
	type EngineInput,
	type EngineNote,
	type EngineResult,
	type JsonValue,
	type OutputFormat,
	type Redacted,
} from '#/server/engines/contract'

import { runEval } from './evaluate'
import type { CallRecord } from './report'

interface Reply {
	readonly delayMs: number
	readonly answer: JsonValue | EngineError
}

interface Script {
	readonly clock: { ms: number }
	readonly received: EngineNote[]
	readonly reply: (input: Redacted<EngineInput>) => Reply
}

/** An engine that answers from a script and moves a fake clock by each reply's delay. */
function fakeEngine(script: Script): Engine {
	async function run<TSchema extends v.GenericSchema>(
		input: Redacted<EngineInput & { readonly output: OutputFormat<TSchema> }>,
	): Promise<EngineResult<v.InferOutput<TSchema>>> {
		script.received.push(input.note)

		const { delayMs, answer } = script.reply(input)

		script.clock.ms += delayMs

		if (answer instanceof EngineError) {
			throw answer
		}

		return { output: parseOutput(input.output, answer), engine: 'fake', model: null, elapsedMs: 0 }
	}

	return { id: 'fake', suggest: run, explain: run, research: run }
}

const suggestion = { categories: ['technology'], senses: [], language: 'en' }

function answerWell(input: Redacted<EngineInput>): Reply {
	if (input.task === 'suggest') {
		return { delayMs: 400, answer: suggestion }
	}

	const card =
		input.output.id === 'brief'
			? briefCardFactory.build({ sources: [], uncertain: true })
			: technologyCardFactory.build({ summary: 'It runs code. We delve into it.', sources: [] })

	return { delayMs: 20_000, answer: card }
}

function answerBadly(input: Redacted<EngineInput>): Reply {
	if (input.task === 'suggest') {
		return {
			delayMs: 3000,
			answer: new EngineError({ kind: 'timeout', afterMs: 3000 }, 'Timed out'),
		}
	}

	const invalid = new EngineError(
		{ kind: 'invalid', issues: ['summary: Invalid length'] },
		'Invalid',
	)

	return { delayMs: 1000, answer: invalid }
}

function checksOf(call: CallRecord | undefined): Record<string, boolean> {
	return Object.fromEntries(call?.checks.map(({ check, passed }) => [check, passed]) ?? [])
}

function inOrder(replies: readonly Reply[]): (input: Redacted<EngineInput>) => Reply {
	let next = 0

	return (input) => {
		const reply = replies.at(next) ?? answerWell(input)

		next += 1

		return reply
	}
}

const auth = new EngineError({ kind: 'auth' }, 'Rejected')

function rateLimited(inMs: number): EngineError {
	return new EngineError({ kind: 'rate_limited', resetsAt: new Date(Date.now() + inMs) }, 'Limited')
}

describe('runEval', () => {
	const technologyNote = evalNoteFactory.build({ id: 'technology-note' })
	const privateNote = privateEvalNoteFactory.build({ id: 'private-note', text: 'Ferritin' })
	const unknowableNote = unknowableEvalNoteFactory.build({ id: 'unknowable-note' })
	const notes = [technologyNote, privateNote, unknowableNote]

	describe('with an engine that answers', () => {
		let received: EngineNote[]
		let calls: readonly CallRecord[]

		beforeEach(async () => {
			const clock = { ms: 0 }

			received = []

			const outcome = await runEval({
				engine: fakeEngine({ clock, received, reply: answerWell }),
				notes,
				language: 'en',
				fillerPhrases: ['delve into'],
				checkLinks: async () => null,
				now: () => clock.ms,
			})

			calls = [...outcome.calls]
		})

		it('records a suggestion and a card for each note, in turn', () => {
			expect(calls.map(({ noteId, task }) => `${noteId} ${task}`)).toEqual([
				'technology-note suggest',
				'technology-note explain',
				'private-note suggest',
				'private-note explain',
				'unknowable-note suggest',
				'unknowable-note explain',
			])
		})

		it('times each call on the clock', () => {
			expect(calls.map(({ elapsedMs }) => elapsedMs)).toEqual([
				400, 20_000, 400, 20_000, 400, 20_000,
			])
		})

		it('sends a private note as its term alone', () => {
			expect(received.at(2)).toEqual({
				term: 'ferritin',
				text: null,
				context: null,
				url: null,
				isPrivate: true,
			})

			expect(checksOf(calls.at(3))).toMatchObject({ private: true })
		})

		it('fails the checks a card breaks and passes the rest', () => {
			expect(checksOf(calls.at(1))).toEqual({ schema: true, oneSentence: false, filler: false })
		})

		it('passes an uncertain card for an unknowable note', () => {
			expect(checksOf(calls.at(5))).toEqual({ schema: true, uncertain: true, filler: true })
		})
	})

	describe('with an engine that fails', () => {
		let calls: readonly CallRecord[]

		beforeEach(async () => {
			const clock = { ms: 0 }

			const outcome = await runEval({
				engine: fakeEngine({ clock, received: [], reply: answerBadly }),
				notes: [technologyNote],
				language: 'en',
				fillerPhrases: [],
				now: () => clock.ms,
			})

			calls = [...outcome.calls]
		})

		it('records an error without checks', () => {
			expect(calls.at(0)).toMatchObject({ error: 'timeout', checks: [], elapsedMs: 3000 })
		})

		it('counts an invalid answer as a schema failure', () => {
			expect(calls.at(1)).toMatchObject({
				error: null,
				checks: [{ check: 'schema', passed: false, detail: 'summary: Invalid length' }],
			})
		})
	})

	describe('when the engine stops answering', () => {
		const clock = { ms: 0 }
		const answered = { delayMs: 10, answer: suggestion }

		async function runWith(replies: readonly Reply[], signal?: AbortSignal) {
			const saved: CallRecord[] = []
			const waits: number[] = []

			const outcome = await runEval({
				engine: fakeEngine({ clock, received: [], reply: inOrder(replies) }),
				notes: [technologyNote, privateNote],
				language: 'en',
				fillerPhrases: [],
				checkLinks: async () => null,
				now: () => clock.ms,
				onCall: async (call) => {
					saved.push(call)
				},
				wait: async (ms) => {
					waits.push(ms)
				},
				...(signal && { signal }),
			})

			return { ...outcome, saved, waits }
		}

		it('stops on a rejected key and keeps every call made so far', async () => {
			const { calls, saved, stopped } = await runWith([answered, { delayMs: 5, answer: auth }])

			expect([calls.length, saved.length, stopped]).toEqual([
				2,
				2,
				'the engine rejected its key or login (auth)',
			])
		})

		it('waits out a usage limit that resets within a minute, then calls again', async () => {
			const { calls, waits, stopped } = await runWith([
				answered,
				{ delayMs: 5, answer: rateLimited(30_000) },
			])

			expect([calls.length, stopped, calls.at(1)?.error]).toEqual([4, null, null])
			expect(waits.at(0)).toBeGreaterThan(29_000)
		})

		it('stops on a usage limit further away', async () => {
			const { calls, stopped } = await runWith([{ delayMs: 5, answer: rateLimited(600_000) }])

			expect(calls.length).toBe(1)
			expect(stopped).toContain('usage limit resets at')
		})

		it('stops when interrupted', async () => {
			const controller = new AbortController()

			controller.abort(new Error('stopped with Ctrl-C'))

			const { calls, stopped } = await runWith([], controller.signal)

			expect([calls, stopped]).toEqual([[], 'interrupted: stopped with Ctrl-C'])
		})
	})
})
