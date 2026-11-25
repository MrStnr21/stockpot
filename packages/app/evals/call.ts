// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

/*
 * What the calls of an eval run share: the run's settings, a call that collects what the engine sent,
 * and the pieces of a checked call. evaluate.ts runs the calls and deeper.ts makes the level-2 one.
 */
import type { FormatId } from '#/lib/format-ids'
import type { Engine, EngineNote, Task, Tier } from '#/server/engines/contract'

import { attempt, type Attempt, type Failure } from './attempt'
import { builtInCategories } from './categories'
import { checkPrivate, invalidAnswer, type CheckResult } from './checks'
import type { Outgoing } from './engines'
import { termOf, type EvalNote } from './notes'
import type { CallRecord } from './report'

export const categoryNames = new Map<string, string>(
	builtInCategories.map(({ id, name }) => [id, name]),
)

// The tiers of the routing table in docs/engines.md.
export function tierFor(format: FormatId): Tier {
	if (format === 'vocabulary') {
		return 'fast'
	}

	return format === 'report' ? 'deep' : 'standard'
}

export function engineNote(note: EvalNote): EngineNote {
	const term = termOf(note.text)

	return {
		term,
		text: note.text === term ? null : note.text,
		context: note.context,
		url: note.url,
		isPrivate: note.private,
	}
}

export function present(result: CheckResult | null): result is CheckResult {
	return result !== null
}

/** The checks of a call that gave no answer: an invalid answer fails `schema`, an error is not checked. */
export function failedChecks(failure: Failure): CheckResult[] {
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
	/** Stop after this many engine calls; every call is one, suggestions and level-2 cards included. */
	readonly maxCalls?: number
	/** After each level-1 card that answered, also ask for its level-2 card, built on the first. */
	readonly deeper?: boolean
	/** Receives each call as soon as it is checked, so a stopped run loses nothing. */
	readonly onCall?: (call: CallRecord) => Promise<void>
	/** Waits out a usage limit that resets within a minute. */
	readonly wait?: (ms: number) => Promise<void>
	/** Stops the run, and the call in flight, as Ctrl-C does. */
	readonly signal?: AbortSignal
	/** What the engine sends; without it the `private` check is not verifiable. */
	readonly outgoing?: Outgoing | null
	/** Each task's timeout; by default the product's, `defaultTimeoutMs`. */
	readonly timeoutsMs?: Readonly<Record<Task, number>>
}

export type Settings = Required<Omit<EvalRun, 'maxCalls' | 'signal' | 'outgoing' | 'deeper'>> & {
	readonly signal: AbortSignal | undefined
	readonly outgoing: Outgoing | null
}

interface Sent<T> {
	readonly call: Attempt<T>
	/** The payloads the call sent, or `null` when the engine's are not recorded. */
	readonly payloads: readonly string[] | null
}

/** Makes a call and collects what it sent; anything sent before belongs to an earlier call. */
export async function send<T>(run: Settings, call: () => Promise<T>): Promise<Sent<T>> {
	await run.outgoing?.take()

	const made = await attempt(run, call)
	const payloads = run.outgoing === null ? null : await run.outgoing.take()

	return { call: made, payloads }
}

/** The private check, for a call that reached the engine; an error may have sent nothing. */
export function privateCheck<T>(note: EvalNote, { call, payloads }: Sent<T>): CheckResult | null {
	return call.failure?.kind === 'error' ? null : checkPrivate(note, payloads)
}

/** A checked call, and why the run must stop after it, if it must. */
export interface Step {
	readonly record: CallRecord
	readonly stop: string | null
}

interface Stoppable {
	readonly signal: AbortSignal | undefined
}

export function signalOf({ signal }: Stoppable): { readonly signal?: AbortSignal } {
	return signal === undefined ? {} : { signal }
}
