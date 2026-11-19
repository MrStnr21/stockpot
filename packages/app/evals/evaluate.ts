// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

/*
 * One eval run: every note goes through the engine's `suggest`, then `explain` (or `research` for an
 * idea), and the automatic checks of evals/rubric.md judge each answer. run.ts is the command line.
 */
import { sleep } from 'bun'

import { cardFormat } from '#/features/research/shared/formats'
import type { FormatId } from '#/lib/format-ids'
import {
	defaultTimeoutMs,
	redactPrivate,
	type Engine,
	type EngineNote,
	type JsonValue,
	type SuggestCategory,
	type Tier,
} from '#/server/engines/contract'
import { abortReason } from '#/server/engines/runs'
import { suggestionFormat } from '#/server/engines/suggestion'

import { attempt, stopReason, type Attempt, type Failure } from './attempt'
import {
	cardLinks,
	checkCategory,
	checkFiller,
	checkOneSentence,
	checkPrivate,
	checkSchema,
	checkSenses,
	checkUncertain,
	invalidAnswer,
	type CheckResult,
} from './checks'
import type { Outgoing } from './engines'
import { checkLinks } from './links'
import { termOf, type EvalNote } from './notes'
import type { CallRecord } from './report'

/** The built-in categories (docs/engines.md, "Formats"); each id is its format id. */
export const builtInCategories = [
	{
		id: 'vocabulary',
		name: 'English',
		hint: 'A word or phrase in a language the owner is learning',
	},
	{ id: 'technology', name: 'Technology', hint: 'A technology or technical term' },
	{
		id: 'comparison',
		name: 'AI',
		hint: 'A product or model in a crowded field, against its alternatives',
	},
	{ id: 'concept', name: 'Concept', hint: 'An idea from any field: a principle, a pattern, a law' },
	{ id: 'report', name: 'Idea', hint: 'An idea the owner might build' },
	{ id: 'brief', name: 'Other', hint: 'Anything else: a short explanation with links' },
] as const satisfies readonly (SuggestCategory & { readonly id: FormatId })[]

const categoryNames = new Map<string, string>(builtInCategories.map(({ id, name }) => [id, name]))

const suggestion = suggestionFormat(builtInCategories.map(({ id }) => id))

// The tiers of the routing table in docs/engines.md.
function tierFor(format: FormatId): Tier {
	if (format === 'vocabulary') {
		return 'fast'
	}

	return format === 'report' ? 'deep' : 'standard'
}

function engineNote(note: EvalNote): EngineNote {
	const term = termOf(note.text)

	return {
		term,
		text: note.text === term ? null : note.text,
		context: note.context,
		url: note.url,
		isPrivate: note.private,
	}
}

function present(result: CheckResult | null): result is CheckResult {
	return result !== null
}

/** The checks of a call that gave no answer: an invalid answer fails `schema`, an error is not checked. */
function failedChecks(failure: Failure): CheckResult[] {
	return failure.kind === 'invalid' ? [invalidAnswer(failure.issues)] : []
}

export interface EvalRun {
	readonly engine: Engine
	readonly notes: readonly EvalNote[]
	/** The card language, as an ISO 639-1 code. */
	readonly language: string
	readonly fillerPhrases: readonly string[]
	readonly checkLinks?: (links: readonly string[]) => Promise<CheckResult | null>
	/** The clock that times each call, in milliseconds. */
	readonly now?: () => number
	/** Stop after this many engine calls; every call is one, suggestions included. */
	readonly maxCalls?: number
	/** Receives each call as soon as it is checked, so a stopped run loses nothing. */
	readonly onCall?: (call: CallRecord) => Promise<void>
	/** Waits out a usage limit that resets within a minute. */
	readonly wait?: (ms: number) => Promise<void>
	/** Stops the run, and the call in flight, as Ctrl-C does. */
	readonly signal?: AbortSignal
	/** What the engine sends; without it the `private` check is not verifiable. */
	readonly outgoing?: Outgoing | null
}

type Settings = Required<Omit<EvalRun, 'maxCalls' | 'signal' | 'outgoing'>> & {
	readonly signal: AbortSignal | undefined
	readonly outgoing: Outgoing | null
}

interface Sent<T> {
	readonly call: Attempt<T>
	/** The payloads the call sent, or `null` when the engine's are not recorded. */
	readonly payloads: readonly string[] | null
}

/** Makes a call and collects what it sent; anything sent before belongs to an earlier call. */
async function send<T>(run: Settings, call: () => Promise<T>): Promise<Sent<T>> {
	await run.outgoing?.take()

	const made = await attempt(run, call)
	const payloads = run.outgoing === null ? null : await run.outgoing.take()

	return { call: made, payloads }
}

/** The private check, for a call that reached the engine; an error may have sent nothing. */
function privateCheck<T>(note: EvalNote, { call, payloads }: Sent<T>): CheckResult | null {
	return call.failure?.kind === 'error' ? null : checkPrivate(note, payloads)
}

/** A checked call, and why the run must stop after it, if it must. */
interface Step {
	readonly record: CallRecord
	readonly stop: string | null
}

interface Stoppable {
	readonly signal: AbortSignal | undefined
}

function signalOf({ signal }: Stoppable): { readonly signal?: AbortSignal } {
	return signal === undefined ? {} : { signal }
}

async function suggestFor(note: EvalNote, run: Settings): Promise<Step> {
	const input = redactPrivate({
		task: 'suggest',
		note: engineNote(note),
		language: run.language,
		output: suggestion,
		categories: builtInCategories,
	})

	const options = { tier: 'fast', timeoutMs: defaultTimeoutMs.suggest, ...signalOf(run) } as const

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
	const options = { tier: tierFor(format), timeoutMs: defaultTimeoutMs[task], ...signalOf(run) }

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

async function take(step: () => Promise<Step>, settings: Settings): Promise<Step> {
	const result = await step()

	await settings.onCall(result.record)

	return result
}

/** Runs every note through the engine, one call at a time so each latency is the call's own. */
export async function runEval(run: EvalRun): Promise<EvalOutcome> {
	const settings: Settings = {
		checkLinks: async (links) => checkLinks(links, signalOf({ signal: run.signal })),
		now: () => performance.now(),
		onCall: keepNothing,
		wait: async (ms) => sleep(ms),
		...run,
		signal: run.signal,
		outgoing: run.outgoing ?? null,
	}

	const calls: CallRecord[] = []
	const maxCalls = run.maxCalls ?? Number.POSITIVE_INFINITY

	const steps = run.notes.flatMap((note) => [
		async () => suggestFor(note, settings),
		async () => cardFor(note, settings),
	])

	for (const step of steps.slice(0, maxCalls)) {
		if (run.signal?.aborted === true) {
			return { calls, stopped: `interrupted: ${abortReason(run.signal).message}` }
		}

		// oxlint-disable-next-line no-await-in-loop -- Calls run in turn, so a latency is never another call's wait.
		const { record, stop } = await take(step, settings)

		calls.push(record)

		if (stop !== null) {
			return { calls, stopped: stop }
		}
	}

	return { calls, stopped: null }
}
