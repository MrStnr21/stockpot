// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

/*
 * The level-2 call of an eval run (`--deeper`, evals/rubric.md): after a note's first card answered,
 * the engine is asked for the second, with the first as its earlier card, as the research feature
 * asks. The `repeats` check measures whether the second builds on the first or copies it.
 */
import * as v from 'valibot'

import { cardFormat, earlierCard } from '#/features/research/shared/formats'
import { redactPrivate, type JsonValue } from '#/server/engines/contract'

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
	type Settings,
	type Step,
} from './call'
import { cardLinks, checkFiller, checkSchema, type CheckResult } from './checks'
import type { EvalNote } from './notes'
import type { CallRecord } from './report'

/** A card as the engine answered it: an object of JSON values. */
type StoredCard = Readonly<Record<string, JsonValue>>

const cardRecord = v.record(
	v.string(),
	v.custom<JsonValue>((value) => value !== undefined),
)

/** Words in a row that the second card may not share with the first. */
export const repeatedRun = 8

// A record schema takes an array too, which is no card.
function asCard(answer: JsonValue | null): StoredCard | null {
	const card = v.safeParse(cardRecord, answer)

	return card.success && !Array.isArray(answer) ? card.output : null
}

/** The first card, when the call answered with a card that fits its format; level 2 builds on it. */
export function answeredCard(record: CallRecord): StoredCard | null {
	const invalid = record.checks.some(({ check, passed }) => check === 'schema' && passed === false)

	return record.error === null && !invalid ? asCard(record.answer) : null
}

// Every string a card holds, at any depth; the keys are not text.
function texts(value: JsonValue): string[] {
	const found: string[] = []

	JSON.stringify(value, (_key, item: JsonValue) => {
		if (v.is(v.string(), item)) {
			found.push(item)
		}

		return item
	})

	return found
}

/** What a reader reads of a card: its text without the sources' titles and addresses. */
function ownTexts({ sources: _sources, ...card }: StoredCard): string[] {
	return texts(card)
}

function wordsOf(text: string): string[] {
	return text
		.toLowerCase()
		.split(/[^\p{L}\p{N}]+/u)
		.filter((word) => word !== '')
}

function runsOf(words: readonly string[]): string[] {
	return Array.from({ length: Math.max(0, words.length - repeatedRun + 1) }, (_, start) =>
		words.slice(start, start + repeatedRun).join(' '),
	)
}

/**
 * The second card builds on the first: no run of 8 words of the second's text appears in the first's,
 * ignoring letter case and punctuation. The first card's `sense` and `aliases` count as its text. A
 * run stays inside one field of the second card, so two fields never join into a phrase nobody wrote.
 */
export function checkRepeats(first: StoredCard, second: StoredCard): CheckResult {
	const firstWords = wordsOf(ownTexts(first).join(' '))
	const seen = new Set(runsOf(firstWords))

	const copied = ownTexts(second)
		.flatMap((text) => runsOf(wordsOf(text)))
		.find((run) => seen.has(run))

	return copied === undefined
		? { check: 'repeats', passed: true, detail: null }
		: { check: 'repeats', passed: false, detail: `repeats "${copied}"` }
}

/** The level-2 call for a note, built on its first card. */
export async function deeperFor(note: EvalNote, run: Settings, first: StoredCard): Promise<Step> {
	const { format } = note.expected

	const base = {
		note: engineNote(note),
		language: run.language,
		output: cardFormat(format, 2),
		category: { name: categoryNames.get(format) ?? format, instructions: null },
		depth: 2,
		previous: [earlierCard(first)],
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
	const second = asCard(call.answer)

	const checks =
		call.failure === null
			? [
					checkSchema(base.output, call.answer),
					await run.checkLinks(cardLinks(call.answer)),
					checkFiller(call.answer, run.fillerPhrases),
					second === null ? null : checkRepeats(first, second),
				]
			: failedChecks(call.failure)

	const record: CallRecord = {
		noteId: note.id,
		task,
		format,
		depth: 2,
		elapsedMs: call.elapsedMs,
		error: call.failure?.kind === 'error' ? call.failure.message : null,
		checks: [...checks, privateCheck(note, sent)].filter((result) => present(result)),
		answer: call.answer,
	}

	return { record, stop: stopReason(call.failure) }
}
