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

describe('runEval', () => {
	const technologyNote = evalNoteFactory.build({ id: 'technology-note' })
	const privateNote = privateEvalNoteFactory.build({ id: 'private-note', text: 'Ferritin' })
	const unknowableNote = unknowableEvalNoteFactory.build({ id: 'unknowable-note' })
	const notes = [technologyNote, privateNote, unknowableNote]

	describe('with an engine that answers', () => {
		let received: EngineNote[]
		let calls: CallRecord[]

		beforeEach(async () => {
			const clock = { ms: 0 }

			received = []

			calls = await runEval({
				engine: fakeEngine({ clock, received, reply: answerWell }),
				notes,
				language: 'en',
				fillerPhrases: ['delve into'],
				checkLinks: async () => null,
				now: () => clock.ms,
			})
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
		let calls: CallRecord[]

		beforeEach(async () => {
			const clock = { ms: 0 }

			calls = await runEval({
				engine: fakeEngine({ clock, received: [], reply: answerBadly }),
				notes: [technologyNote],
				language: 'en',
				fillerPhrases: [],
				now: () => clock.ms,
			})
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
})
