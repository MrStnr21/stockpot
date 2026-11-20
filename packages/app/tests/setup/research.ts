// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { mock, type Mock } from 'bun:test'
import { faker } from '@faker-js/faker'
import { briefCardFactory, reportCardFactory } from '#tests/factories/cards'
import { configuredSettingsFactory } from '#tests/factories/settings'
import { createTestDb, type TestDb } from '#tests/setup/db'
import { advanceBy } from '#tests/setup/jobs'
import type * as v from 'valibot'

import {
	createResearchJob,
	queueResearch,
	type LearnedCard,
	type ResearchPayload,
} from '#/features/research/server/pipeline'
import {
	EngineError,
	parseOutput,
	type EngineInput,
	type OutputFormat,
	type Redacted,
	type RunOptions,
	type Tier,
} from '#/server/engines/contract'
import { createRouter } from '#/server/engines/router'
import { defaultRouting, type EngineId } from '#/server/engines/settings'
import type { Priority } from '#/server/jobs/queue'
import { createRunner } from '#/server/jobs/runner'
import type { JobDefinition, Runner } from '#/server/jobs/types'

export interface EngineCall {
	readonly method: 'explain' | 'research'
	readonly input: Redacted<EngineInput>
	readonly tier: Tier
}

/** An engine that records each call and answers with a sample card, or fails while `failure` is set. */
export interface FakeEngine {
	readonly calls: EngineCall[]
	/** The cards it answered with, in order. */
	readonly answers: LearnedCard[]
	failure: Error | null
	/** Runs inside each call, before it answers. */
	during: () => void
}

async function neverSuggest(): Promise<never> {
	throw new Error('The research job never suggests')
}

function fakeEngine(id: EngineId) {
	const state: FakeEngine = {
		calls: [],
		answers: [],
		failure: null,
		during: () => {
			// A spec sets this to look at the database while the call is in flight.
		},
	}

	function method(name: EngineCall['method']) {
		return async <TSchema extends v.GenericSchema>(
			input: Redacted<EngineInput & { readonly output: OutputFormat<TSchema> }>,
			{ tier }: RunOptions,
		) => {
			state.calls.push({ method: name, input, tier })
			state.during()

			if (state.failure !== null) {
				throw state.failure
			}

			const aliases = [faker.word.noun()]

			const answer =
				input.output.id === 'report'
					? reportCardFactory.build({ aliases })
					: briefCardFactory.build({ aliases })

			state.answers.push(answer)

			const output = parseOutput(input.output, answer)

			return { output, engine: id, model: null, searchSuggestions: null, elapsedMs: 0 }
		}
	}

	return {
		engine: { id, suggest: neverSuggest, explain: method('explain'), research: method('research') },
		state,
	}
}

export function limitedUntil(resetsAt: Date): EngineError {
	return new EngineError({ kind: 'rate_limited', resetsAt }, 'The limit is reached')
}

/** A research job on a real runner and router, whose engines are fakes. */
export interface ResearchHarness {
	readonly db: TestDb
	readonly runner: Runner
	readonly job: JobDefinition<ResearchPayload>
	readonly gemini: FakeEngine
	readonly openAi: FakeEngine
	readonly later: Mock<(payload: ResearchPayload, runAt: Date) => void>
	readonly learn: Mock<(termId: number, card: LearnedCard) => void>
	/** Queues the notes' research as a route would. */
	readonly queue: (noteIds: readonly number[], priority?: Priority) => void
	/** Queues the notes' research, then runs what is due. */
	readonly research: (noteIds: readonly number[]) => Promise<void>
}

/** Starts the runner; the spec stops it. Turn on fake timers first. */
export async function startResearch(): Promise<ResearchHarness> {
	const { db } = await createTestDb()
	const { engines } = configuredSettingsFactory.build()
	const gemini = fakeEngine('gemini')
	const openAi = fakeEngine('openai-compatible')

	const router = createRouter({
		db,
		settings: () => ({ engines, routing: defaultRouting() }),
		agentCommand: null,
		build: () => ({
			'agent-command': null,
			gemini: gemini.engine,
			'openai-compatible': openAi.engine,
		}),
	})

	const later: ResearchHarness['later'] = mock((payload, runAt) => {
		runner.enqueue(job, payload, { runAt })
	})

	const learn: ResearchHarness['learn'] = mock(() => {
		// A spec checks the calls, or replaces this to make learning fail.
	})

	const { cardLanguage } = configuredSettingsFactory.build()
	const job = createResearchJob({ db, router, language: () => cardLanguage, later, learn })
	const runner = createRunner({ db, jobs: [job] })

	runner.start()

	function queue(noteIds: readonly number[], priority: Priority = 'now') {
		queueResearch(
			{
				db,
				enqueue: (payload, at) => {
					runner.enqueue(job, payload, { priority: at })
				},
			},
			noteIds,
			priority,
		)
	}

	async function research(noteIds: readonly number[]) {
		queue(noteIds)
		await advanceBy(runner, 0)
	}

	return {
		db,
		runner,
		job,
		gemini: gemini.state,
		openAi: openAi.state,
		later,
		learn,
		queue,
		research,
	}
}
