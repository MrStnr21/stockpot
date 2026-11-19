// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

/*
 * A scripted engine for the eval runner's specs: it answers from a script, validates the answer as a
 * real engine does, and moves a fake clock by each reply's delay so no spec waits for real time.
 */
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

export interface Reply {
	readonly delayMs: number
	readonly answer: JsonValue | EngineError
}

export interface Script {
	readonly clock: { ms: number }
	readonly received: EngineNote[]
	/** What the engine sent, as a recording engine would report it. */
	readonly sent?: string[]
	readonly reply: (input: Redacted<EngineInput>) => Reply
}

/** An engine that answers from a script and moves a fake clock by each reply's delay. */
export function fakeEngine(script: Script): Engine {
	async function run<TSchema extends v.GenericSchema>(
		input: Redacted<EngineInput & { readonly output: OutputFormat<TSchema> }>,
	): Promise<EngineResult<v.InferOutput<TSchema>>> {
		script.received.push(input.note)
		script.sent?.push(JSON.stringify(input))

		const { delayMs, answer } = script.reply(input)

		script.clock.ms += delayMs

		if (answer instanceof EngineError) {
			throw answer
		}

		return { output: parseOutput(input.output, answer), engine: 'fake', model: null, elapsedMs: 0 }
	}

	return { id: 'fake', suggest: run, explain: run, research: run }
}
