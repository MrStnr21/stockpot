// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import type { EngineTestOutcome } from '#/server/engines/probe'
import type { EngineId } from '#/server/engines/settings'

export type { EngineId } from '#/server/engines/settings'

/** The engine ids for the browser, which may not import the server's list; same order. */
export const engineIds = [
	'agent-command',
	'gemini',
	'openai-compatible',
] as const satisfies readonly EngineId[]

/** What a test can end with, for the browser. */
export const testOutcomes = [
	'ok',
	'rate_limited',
	'auth',
	'timeout',
	'invalid',
	'error',
] as const satisfies readonly EngineTestOutcome[]

/* `satisfies` refuses an id the server does not have; these refuse to compile when the server adds
 * one that the lists above leave out. */
export const allEnginesListed: [Exclude<EngineId, (typeof engineIds)[number]>] extends [never]
	? true
	: never = true

export const allOutcomesListed: [
	Exclude<EngineTestOutcome, (typeof testOutcomes)[number]>,
] extends [never]
	? true
	: never = true
