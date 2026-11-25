// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

/*
 * One eval run: every note goes through the engine's `suggest`, then `explain` (or `research` for an
 * idea), and the automatic checks of evals/rubric.md judge each answer. run.ts is the command line.
 */
import { sleep } from 'bun'

import { cardFormat } from '#/features/research/shared/formats'
import { defaultTimeoutMs, redactPrivate, type JsonValue } from '#/server/engines/contract'
import { abortReason } from '#/server/engines/runs'
import { suggestionFormat } from '#/server/engines/suggestion'

import { stopReason } from './attempt'
import {
	categoryNames,
	engineNote,
	failedChecks,
	present,
	privateCheck,
	send,
	signalOf,
	tierFor,
	type EvalRun,
	type Settings,
	type Step,
} from './call'
import { builtInCategories } from './categories'
import {
	cardLinks,
	checkCategory,
	checkFiller,
	checkOneSentence,
	checkSchema,
	checkSenses,
	checkUncertain,
} from './checks'
import { answeredCard, deeperFor } from './deeper'
import { checkLinks } from './links'
import type { EvalNote } from './notes'
import type { CallRecord } from './report'

export type { EvalRun } from './call'

const suggestion = suggestionFormat(builtInCategories.map(({ id }) => id))

async function suggestFor(note: EvalNote, run: Settings): Promise<Step> {
	const input = redactPrivate({
		task: 'suggest',
		note: engineNote(note),
		language: run.language,
		output: suggestion,
		categories: builtInCategories,
	})

	const options = { tier: 'fast', timeoutMs: run.timeoutsMs.suggest, ...signalOf(run) } as const

	const sent = await send(run, async () => {
		const result = await run.engine.suggest(input, options)

		return result.output
	})

	const { call } = sent

	const checks =
		call.failure === null
			? [
					checkSchema(input.output, call.answer),
					checkCategory(note, call.answer.categories),
					checkSenses(note, call.answer.senses.length),
				]
			: failedChecks(call.failure)

	const record: CallRecord = {
		noteId: note.id,
		task: 'suggest',
		format: 'suggestion',
		depth: 1,
		elapsedMs: call.elapsedMs,
		error: call.failure?.kind === 'error' ? call.failure.message : null,
		checks: [...checks, privateCheck(note, sent)].filter((result) => present(result)),
		answer: call.answer,
	}

	return { record, stop: stopReason(call.failure) }
}

async function cardFor(note: EvalNote, run: Settings): Promise<Step> {
	const { format } = note.expected

	const base = {
		note: engineNote(note),
		language: run.language,
		output: cardFormat(format, 1),
		category: { name: categoryNames.get(format) ?? format, instructions: null },
		depth: 1,
		previous: [],
	} as const

	const task = format === 'report' ? 'research' : 'explain'
	const options = { tier: tierFor(format), timeoutMs: run.timeoutsMs[task], ...signalOf(run) }

	const sent = await send<JsonValue>(run, async () => {
		const result =
			task === 'research'
				? await run.engine.research(redactPrivate({ ...base, task }), options)
				: await run.engine.explain(redactPrivate({ ...base, task }), options)

		return result.output
	})

	const { call } = sent

	const checks =
		call.failure === null
			? [
					checkSchema(base.output, call.answer),
					await run.checkLinks(cardLinks(call.answer)),
					checkOneSentence(format, call.answer, run.language),
					checkUncertain(note, call.answer),
					checkFiller(call.answer, run.fillerPhrases),
				]
			: failedChecks(call.failure)

	const record: CallRecord = {
		noteId: note.id,
		task,
		format,
		depth: 1,
		elapsedMs: call.elapsedMs,
		error: call.failure?.kind === 'error' ? call.failure.message : null,
		checks: [...checks, privateCheck(note, sent)].filter((result) => present(result)),
		answer: call.answer,
	}

	return { record, stop: stopReason(call.failure) }
}

export interface EvalOutcome {
	readonly calls: readonly CallRecord[]
	/** Why the run stopped before its last call, or `null` when it ran to the end. */
	readonly stopped: string | null
}

async function keepNothing(): Promise<void> {
	// Without onCall the run keeps its calls in memory only.
}

/** A call to make, or `null` when it turns out there is nothing to ask. */
type Plan = () => Promise<Step | null>

async function take(step: Plan, settings: Settings): Promise<Step | null> {
	const result = await step()

	if (result !== null) {
		await settings.onCall(result.record)
	}

	return result
}

/** Runs every note through the engine, one call at a time so each latency is the call's own. */
export async function runEval(run: EvalRun): Promise<EvalOutcome> {
	const settings: Settings = {
		checkLinks: async (links) => checkLinks(links, signalOf({ signal: run.signal })),
		now: () => performance.now(),
		onCall: keepNothing,
		wait: async (ms) => sleep(ms),
		timeoutsMs: defaultTimeoutMs,
		...run,
		signal: run.signal,
		outgoing: run.outgoing ?? null,
	}

	const calls: CallRecord[] = []
	const maxCalls = run.maxCalls ?? Number.POSITIVE_INFINITY

	// The level-1 cards that answered, which level 2 builds on.
	const firstCards = new Map<string, NonNullable<ReturnType<typeof answeredCard>>>()

	const steps = run.notes.flatMap((note): Plan[] => [
		async () => suggestFor(note, settings),
		async () => {
			const step = await cardFor(note, settings)
			const first = answeredCard(step.record)

			if (first !== null) {
				firstCards.set(note.id, first)
			}

			return step
		},
		...(run.deeper === true
			? [
					async () => {
						const first = firstCards.get(note.id)

						return first === undefined ? null : deeperFor(note, settings, first)
					},
				]
			: []),
	])

	for (const step of steps) {
		if (calls.length >= maxCalls) {
			break
		}

		if (run.signal?.aborted === true) {
			return { calls, stopped: `interrupted: ${abortReason(run.signal).message}` }
		}

		// oxlint-disable-next-line no-await-in-loop -- Calls run in turn, so a latency is never another call's wait.
		const taken = await take(step, settings)

		if (taken !== null) {
			calls.push(taken.record)

			if (taken.stop !== null) {
				return { calls, stopped: taken.stop }
			}
		}
	}

	return { calls, stopped: null }
}
