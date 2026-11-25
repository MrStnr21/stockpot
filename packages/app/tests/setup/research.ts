// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { mock, type Mock } from 'bun:test'
import { faker } from '@faker-js/faker'
import { briefCardFactory, cardFactories, reportCardFactory } from '#tests/factories/cards'
import { configuredSettingsFactory } from '#tests/factories/settings'
import { createTestDb, type TestDb } from '#tests/setup/db'
import { advanceBy } from '#tests/setup/jobs'
import { asc, eq } from 'drizzle-orm'
import type * as v from 'valibot'

import { createDeeperJob, type DeeperPayload } from '#/features/research/server/depth'
import type { ReadyNote } from '#/features/research/server/engine-call'
import type { ProgressBoard } from '#/features/research/server/ideas'
import {
	createResearchJob,
	priorityOf,
	queueResearch,
	type LearnedCard,
	type ResearchPayload,
} from '#/features/research/server/pipeline'
import type { Source } from '#/features/research/shared/formats'
import { isFormatId } from '#/lib/format-ids'
import { explanations } from '#/server/db/schema/explanations'
import { notes, type NoteStatus } from '#/server/db/schema/notes'
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
import type { LinkOutcome } from '#/server/links/open-link'

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
	sources?: Source[]
	failure: Error | null
	/** Runs inside each call, before it answers, with the options the router passed. */
	during: (options: RunOptions) => void | Promise<void>
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
			options: RunOptions,
		) => {
			state.calls.push({ method: name, input, tier: options.tier })
			await state.during(options)

			if (state.failure !== null) {
				throw state.failure
			}

			const { sources } = state
			const withSources = sources === undefined ? {} : { sources }

			// A deeper card has its own schema, and the strict ones reject a first card's `aliases`.
			if (input.task !== 'suggest' && input.depth > 1) {
				if (!isFormatId(input.output.id)) {
					throw new Error('The fake engine knows no such format')
				}

				const deeper = cardFactories[input.output.id][input.depth].build(withSources)

				return {
					output: parseOutput(input.output, deeper),
					engine: id,
					model: null,
					searchSuggestions: null,
					elapsedMs: 0,
				}
			}

			const params = { aliases: [faker.word.noun()], ...withSources }

			const answer =
				input.output.id === 'report'
					? reportCardFactory.build(params)
					: briefCardFactory.build(params)

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
	readonly deeperJob: JobDefinition<DeeperPayload>
	readonly gemini: FakeEngine
	readonly openAi: FakeEngine
	readonly links: Map<string, LinkOutcome>
	readonly statusOf: (noteId: number) => NoteStatus | undefined
	readonly cardsOf: (noteId: number) => (typeof explanations.$inferSelect)[]
	readonly later: Mock<(payload: ResearchPayload, runAt: Date) => void>
	readonly laterDeeper: Mock<(payload: DeeperPayload, runAt: Date) => void>
	readonly learn: Mock<(termId: number, card: LearnedCard) => void>
	readonly notify: Mock<(ready: ReadyNote) => void | Promise<void>>
	/** Queues the notes' research as a route would. */
	readonly queue: (noteIds: readonly number[], priority?: Priority) => void
	/** Queues the notes' research, then runs what is due. */
	readonly research: (noteIds: readonly number[]) => Promise<void>
	/** Queues level `depth` of the note's card, then runs what is due. */
	readonly deepen: (noteId: number, depth: 2 | 3, priority?: Priority) => Promise<void>
}

function cardsIn(db: TestDb, noteId: number) {
	return db
		.select()
		.from(explanations)
		.where(eq(explanations.noteId, noteId))
		.orderBy(asc(explanations.id))
		.all()
}

/** Starts the runner; the spec stops it. Turn on fake timers first. `progress` is the job's board. */
export async function startResearch(progress?: ProgressBoard): Promise<ResearchHarness> {
	const { db } = await createTestDb()
	const { engines } = configuredSettingsFactory.build()
	const gemini = fakeEngine('gemini')
	const openAi = fakeEngine('openai-compatible')
	const links = new Map<string, LinkOutcome>()

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
		runner.enqueue(job, payload, { runAt, priority: priorityOf(payload) })
	})

	const laterDeeper: ResearchHarness['laterDeeper'] = mock((payload, runAt) => {
		runner.enqueue(deeperJob, payload, { runAt, priority: priorityOf(payload) })
	})

	const learn: ResearchHarness['learn'] = mock(() => {
		// A spec checks the calls, or replaces this to make learning fail.
	})

	const notify: ResearchHarness['notify'] = mock(() => {
		// A spec checks the calls, or replaces this to make notifying fail.
	})

	const { cardLanguage } = configuredSettingsFactory.build()

	const job = createResearchJob({
		db,
		router,
		language: () => cardLanguage,
		later,
		learn,
		notify,
		progress,
		openLink: async (url) => links.get(url) ?? { kind: 'open', status: 200 },
	})

	const deeperJob = createDeeperJob({
		db,
		router,
		language: () => cardLanguage,
		later: laterDeeper,
		notify,
		openLink: async (url) => links.get(url) ?? { kind: 'open', status: 200 },
	})

	const runner = createRunner({ db, jobs: [job, deeperJob] })

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

	function statusOf(noteId: number) {
		return db.select({ status: notes.status }).from(notes).where(eq(notes.id, noteId)).get()?.status
	}

	async function research(noteIds: readonly number[]) {
		queue(noteIds)
		await advanceBy(runner, 0)
	}

	async function deepen(noteId: number, depth: 2 | 3, priority: Priority = 'now') {
		runner.enqueue(
			deeperJob,
			priority === 'now' ? { noteId, depth, now: true } : { noteId, depth },
			{ priority },
		)
		await advanceBy(runner, 0)
	}

	return {
		db,
		runner,
		job,
		deeperJob,
		gemini: gemini.state,
		openAi: openAi.state,
		links,
		later,
		laterDeeper,
		learn,
		notify,
		statusOf,
		cardsOf: (noteId) => cardsIn(db, noteId),
		queue,
		research,
		deepen,
	}
}
