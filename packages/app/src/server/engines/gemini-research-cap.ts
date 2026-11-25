// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

/*
 * The cap of one step of the Gemini research loop (docs/engines.md, "The Gemini engine"). Only
 * `gemini-research.ts` uses it.
 */
import { EngineError } from './contract'

export const capped = Symbol('capped')

/**
 * Runs `work` with a signal that aborts after `ms`, and answers `capped` when that stopped it. Any
 * other failure, the call's own deadline and the caller's abort included, is thrown on unchanged. The
 * timer is a `setTimeout` so that fake timers can drive it.
 */
export async function within<T>(
	ms: number,
	work: (signal: AbortSignal) => Promise<T>,
): Promise<T | typeof capped> {
	const controller = new AbortController()

	const reason = new EngineError(
		{ kind: 'timeout', afterMs: ms },
		`A research step did not finish within ${ms} ms`,
	)

	const timer = setTimeout(() => {
		controller.abort(reason)
	}, ms)

	try {
		return await work(controller.signal)
	} catch (error) {
		if (error === reason) {
			return capped
		}

		throw error
	} finally {
		clearTimeout(timer)
	}
}
