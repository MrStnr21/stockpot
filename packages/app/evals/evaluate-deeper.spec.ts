// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { beforeEach, describe, expect, it } from 'bun:test'
import { deeperCardFactory, technologyCardFactory } from '#tests/factories/cards'
import { evalNoteFactory, privateEvalNoteFactory } from '#tests/factories/eval-notes'
import { fakeEngine, type Reply } from '#tests/setup/fake-engine'

import { cardFormat, earlierCard } from '#/features/research/shared/formats'
import {
	EngineError,
	type EngineInput,
	type JsonValue,
	type Redacted,
} from '#/server/engines/contract'

import { runEval } from './evaluate'
import type { CallRecord } from './report'

const suggestion = { categories: ['technology'], senses: [], language: 'en' }

const firstCard = technologyCardFactory.build({
	summary: 'one two three four five six seven eight nine ten.',
	sources: [],
})

const copying = deeperCardFactory.build({
	howItWorks: 'Notes: one two three four five six seven eight.',
	sources: [],
})

function checksOf(call: CallRecord | undefined): Record<string, boolean | null> {
	return Object.fromEntries(call?.checks.map(({ check, passed }) => [check, passed]) ?? [])
}

describe('runEval with deeper', () => {
	const technologyNote = evalNoteFactory.build({ id: 'technology-note' })
	const privateNote = privateEvalNoteFactory.build({ id: 'private-note', text: 'Ferritin' })
	let inputs: Redacted<EngineInput>[]
	let sent: string[]
	let level1: Reply

	beforeEach(() => {
		inputs = []
		sent = []
		level1 = { delayMs: 10, answer: firstCard }
	})

	function reply(input: Redacted<EngineInput>, second: JsonValue): Reply {
		inputs.push(input)

		if (input.task === 'suggest') {
			return { delayMs: 10, answer: suggestion }
		}

		return input.depth === 2 ? { delayMs: 10, answer: second } : level1
	}

	async function run(options: { deeper?: boolean; maxCalls?: number; notes?: 'private' } = {}) {
		const { deeper = true, maxCalls, notes } = options
		const clock = { ms: 0 }

		const { calls } = await runEval({
			engine: fakeEngine({
				clock,
				received: [],
				sent,
				reply: (input) => reply(input, deeperCardFactory.build({ sources: [] })),
			}),
			outgoing: { take: async () => sent.splice(0) },
			notes: notes === 'private' ? [privateNote] : [technologyNote, privateNote],
			language: 'en',
			fillerPhrases: [],
			checkLinks: async () => null,
			now: () => clock.ms,
			...(deeper && { deeper }),
			...(maxCalls !== undefined && { maxCalls }),
		})

		return calls
	}

	it('asks for level 2 after each card that answered, on the first card', async () => {
		const calls = await run()

		expect(calls.map(({ noteId, task, depth }) => `${noteId} ${task} ${depth}`)).toEqual([
			'technology-note suggest 1',
			'technology-note explain 1',
			'technology-note explain 2',
			'private-note suggest 1',
			'private-note explain 1',
			'private-note explain 2',
		])

		const second = inputs.at(2)

		expect(second).toMatchObject({ task: 'explain', depth: 2, previous: [earlierCard(firstCard)] })
		expect(second?.output.id).toBe('technology')
		expect(second?.output.instructions).toBe(cardFormat('technology', 2).instructions)
		expect(checksOf(calls.at(2))).toEqual({ schema: true, filler: true, repeats: true })
	})

	it('sends a private note term alone and no earlier card, and runs its private check', async () => {
		const calls = await run({ notes: 'private' })

		expect(inputs.at(2)).toMatchObject({
			depth: 2,
			previous: [],
			note: { term: 'ferritin', text: null, context: null, url: null, isPrivate: true },
		})
		expect(checksOf(calls.at(2))).toEqual({
			schema: true,
			filler: true,
			repeats: true,
			private: true,
		})
	})

	it('fails the repeats check for a card that copies level 1', async () => {
		const clock = { ms: 0 }

		const { calls } = await runEval({
			engine: fakeEngine({ clock, received: [], reply: (input) => reply(input, copying) }),
			notes: [technologyNote],
			language: 'en',
			fillerPhrases: [],
			checkLinks: async () => null,
			now: () => clock.ms,
			deeper: true,
		})

		expect(calls.at(2)?.checks).toContainEqual({
			check: 'repeats',
			passed: false,
			detail: 'repeats "one two three four five six seven eight"',
		})
	})

	it('asks nothing more of a note whose first card failed', async () => {
		level1 = { delayMs: 10, answer: new EngineError({ kind: 'invalid', issues: ['summary'] }, 'x') }

		const calls = await run({ notes: 'private' })

		expect(calls.map(({ task, depth }) => `${task} ${depth}`)).toEqual(['suggest 1', 'explain 1'])
	})

	it('makes no level-2 call after a suggestion alone', async () => {
		const calls = await run({ maxCalls: 1 })

		expect(calls.map(({ task, depth }) => `${task} ${depth}`)).toEqual(['suggest 1'])
	})

	it('counts the level-2 call in maxCalls', async () => {
		const calls = await run({ maxCalls: 3 })

		expect(calls.map(({ task, depth }) => `${task} ${depth}`)).toEqual([
			'suggest 1',
			'explain 1',
			'explain 2',
		])
	})

	it('makes the calls it always did without the flag', async () => {
		const calls = await run({ deeper: false })

		expect(calls.map(({ task, depth }) => `${task} ${depth}`)).toEqual([
			'suggest 1',
			'explain 1',
			'suggest 1',
			'explain 1',
		])
	})
})
