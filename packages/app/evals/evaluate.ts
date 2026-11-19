// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

/*
 * One eval run: every note goes through the engine's `suggest`, then `explain` (or `research` for an
 * idea), and the automatic checks of evals/rubric.md judge each answer. run.ts is the command line.
 */
import { cardFormat } from '#/features/research/shared/formats'
import type { FormatId } from '#/lib/format-ids'
import {
	defaultTimeoutMs,
	EngineError,
	redactPrivate,
	type Engine,
	type EngineNote,
	type JsonValue,
	type SuggestCategory,
	type Tier,
} from '#/server/engines/contract'
import { suggestionFormat } from '#/server/engines/suggestion'

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
import { checkLinks } from './links'
import type { EvalNote } from './notes'
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

/* Lowercase with single spaces, close enough to capture's term for the eval; the normalization
 * that capture will use (CAP) can replace it once it exists. */
function termOf(text: string): string {
	return text.trim().replaceAll(/\s+/gu, ' ').toLowerCase()
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

type Failure =
	| { readonly kind: 'invalid'; readonly issues: readonly string[] }
	| { readonly kind: 'error'; readonly message: string }

type Attempt<T> =
	| { readonly answer: T; readonly failure: null; readonly elapsedMs: number }
	| { readonly answer: null; readonly failure: Failure; readonly elapsedMs: number }

/** Runs one call and times it, whatever its outcome. */
async function attempt<T>(now: () => number, call: () => Promise<T>): Promise<Attempt<T>> {
	const startedAt = now()

	try {
		const answer = await call()

		return { answer, failure: null, elapsedMs: now() - startedAt }
	} catch (error) {
		const elapsedMs = now() - startedAt

		if (error instanceof EngineError && error.failure.kind === 'invalid') {
			return { answer: null, failure: { kind: 'invalid', issues: error.failure.issues }, elapsedMs }
		}

		const message = error instanceof EngineError ? error.kind : String(error)

		return { answer: null, failure: { kind: 'error', message }, elapsedMs }
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
}

type Settings = Required<EvalRun>

async function suggestFor(note: EvalNote, run: Settings): Promise<CallRecord> {
	const input = redactPrivate({
		task: 'suggest',
		note: engineNote(note),
		language: run.language,
		output: suggestion,
		categories: builtInCategories,
	})

	const options = { tier: 'fast', timeoutMs: defaultTimeoutMs.suggest } as const

	const call = await attempt(run.now, async () => {
		const result = await run.engine.suggest(input, options)

		return result.output
	})

	const sent = checkPrivate(note, { note: input.note, previous: [] })

	const checks =
		call.failure === null
			? [
					checkSchema(input.output, call.answer),
					checkCategory(note, call.answer.categories),
					checkSenses(note, call.answer.senses.length),
				]
			: failedChecks(call.failure)

	return {
		noteId: note.id,
		task: 'suggest',
		format: 'suggestion',
		elapsedMs: call.elapsedMs,
		error: call.failure?.kind === 'error' ? call.failure.message : null,
		checks: [...checks, sent].filter((result) => present(result)),
		answer: call.answer,
	}
}

async function cardFor(note: EvalNote, run: Settings): Promise<CallRecord> {
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
	const options = { tier: tierFor(format), timeoutMs: defaultTimeoutMs[task] }

	const call = await attempt<JsonValue>(run.now, async () => {
		const result =
			task === 'research'
				? await run.engine.research(redactPrivate({ ...base, task }), options)
				: await run.engine.explain(redactPrivate({ ...base, task }), options)

		return result.output
	})

	const sent = checkPrivate(note, { note: redactPrivate({ ...base, task }).note, previous: [] })

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

	return {
		noteId: note.id,
		task,
		format,
		elapsedMs: call.elapsedMs,
		error: call.failure?.kind === 'error' ? call.failure.message : null,
		checks: [...checks, sent].filter((result) => present(result)),
		answer: call.answer,
	}
}

/** Runs every note through the engine, one call at a time so each latency is the call's own. */
export async function runEval(run: EvalRun): Promise<CallRecord[]> {
	const settings: Settings = {
		checkLinks: async (links) => checkLinks(links),
		now: () => performance.now(),
		...run,
	}

	const calls: CallRecord[] = []

	for (const note of run.notes) {
		// oxlint-disable-next-line no-await-in-loop -- Calls run in turn, so a latency is never another call's wait.
		calls.push(await suggestFor(note, settings), await cardFor(note, settings))
	}

	return calls
}
