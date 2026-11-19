// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

/*
 * The engines the eval can run, by id. The server reads engine settings from the database; the eval
 * reads them from the environment instead, so keys stay outside the repository and no instance is
 * needed. Gemini joins with one entry when ENG-4 adds its engine.
 */
import * as v from 'valibot'

import type { Db } from '#/server/db/client'
import { createAgentCommandEngine } from '#/server/engines/agent-cli'
import type { Engine } from '#/server/engines/contract'
import { createOpenAiCompatibleEngine } from '#/server/engines/openai-compatible'
import { enginesSchema } from '#/server/engines/settings'

export type EvalEnv = Readonly<Record<string, string | undefined>>

export interface EngineContext {
	readonly env: EvalEnv
	/** Where the engine records its `engine_runs` rows: an in-memory database for the run. */
	readonly db: Db
}

function optional(env: EvalEnv, name: string): string | null {
	const value = env[name]?.trim()

	return value === undefined || value === '' ? null : value
}

function required(env: EvalEnv, name: string): string {
	const value = optional(env, name)

	if (value === null) {
		throw new Error(`Set ${name} to run the eval with this engine`)
	}

	return value
}

const openAiCompatibleSettings = enginesSchema.entries['openai-compatible']

export const evalEngines = {
	'agent-command': ({ env, db }: EngineContext): Engine =>
		createAgentCommandEngine({ command: required(env, 'STOCKPOT_AGENT_COMMAND'), db }),
	'openai-compatible': ({ env, db }: EngineContext): Engine => {
		// One model serves every tier: the eval measures an engine, not a tier mapping.
		const model = required(env, 'STOCKPOT_EVAL_OPENAI_MODEL')

		const settings = v.parse(openAiCompatibleSettings, {
			baseUrl: required(env, 'STOCKPOT_EVAL_OPENAI_BASE_URL'),
			apiKey: optional(env, 'STOCKPOT_EVAL_OPENAI_KEY'),
			models: { fast: model, standard: model, deep: model },
		})

		return createOpenAiCompatibleEngine({ db, settings: () => settings })
	},
} as const

export type EvalEngineId = keyof typeof evalEngines

export function isEvalEngineId(id: string): id is EvalEngineId {
	return Object.hasOwn(evalEngines, id)
}

export function createEvalEngine(id: EvalEngineId, context: EngineContext): Engine {
	return evalEngines[id](context)
}
