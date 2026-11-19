// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

/*
 * The engines the eval can run, by id. The server reads engine settings from the database; the eval
 * reads them from the environment instead, so keys stay outside the repository and no instance is
 * needed. Gemini joins with one entry when ENG-4 adds its engine.
 *
 * Each entry also records what the engine sends, through a setting the engine already takes, so the
 * `private` check can test the payload rather than our own input: the OpenAI-compatible base URL
 * points at a recording proxy on this machine, and the agent command runs behind record-agent.ts.
 */
import { $, file, Glob, serve } from 'bun'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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

/** What an engine sent since the last `take`: request bodies, or an agent's arguments and stdin. */
export interface Outgoing {
	readonly take: () => Promise<readonly string[]>
}

export interface EvalEngine {
	readonly engine: Engine
	/** `null` for an engine whose payload cannot be recorded: its `private` check is not verifiable. */
	readonly outgoing: Outgoing | null
	readonly close: () => Promise<void>
}

const openAiCompatibleSettings = enginesSchema.entries['openai-compatible']

// Headers that described the upstream body as sent; fetch has already decoded it.
const hopHeaders = ['content-encoding', 'content-length', 'transfer-encoding', 'host']

function withoutHopHeaders(headers: Headers): Headers {
	const kept = new Headers(headers)

	for (const name of hopHeaders) {
		kept.delete(name)
	}

	return kept
}

/** A proxy on this machine that records each request body and forwards it to `upstream`. */
function recordingProxy(upstream: string) {
	const bodies: string[] = []
	const base = upstream.replace(/\/$/u, '')

	const proxy = serve({
		hostname: '127.0.0.1',
		port: 0,
		fetch: async (request) => {
			const body = await request.text()
			const { pathname, search } = new URL(request.url)

			bodies.push(body)

			const reply = await fetch(`${base}${pathname}${search}`, {
				method: request.method,
				headers: withoutHopHeaders(request.headers),
				body,
			})

			return new Response(reply.body, {
				status: reply.status,
				headers: withoutHopHeaders(reply.headers),
			})
		},
	})

	return {
		url: `http://127.0.0.1:${proxy.port}`,
		outgoing: { take: async () => bodies.splice(0) },
		close: async () => proxy.stop(true),
	}
}

function quoted(path: string): string {
	if (path.includes("'")) {
		throw new Error(`The eval cannot quote the path ${path}`)
	}

	return `'${path}'`
}

async function agentCommand({ env, db }: EngineContext): Promise<EvalEngine> {
	const template = required(env, 'STOCKPOT_AGENT_COMMAND')
	const captureDir = join(tmpdir(), `stockpot-eval-agent-${crypto.randomUUID()}`)
	const recorder = join(import.meta.dir, 'record-agent.ts')

	await $`mkdir -p ${captureDir}`

	const command = [process.execPath, recorder, captureDir].map((path) => quoted(path)).join(' ')

	async function take(): Promise<string[]> {
		const names = await Array.fromAsync(new Glob('*.json').scan({ cwd: captureDir }))
		const paths = names.map((name) => join(captureDir, name))
		const payloads = await Promise.all(paths.map(async (path) => file(path).text()))

		await Promise.all(paths.map(async (path) => file(path).delete()))

		return payloads
	}

	return {
		engine: createAgentCommandEngine({ command: `${command} ${template}`, db }),
		outgoing: { take },
		close: async () => {
			await $`rm -rf ${captureDir}`
		},
	}
}

async function openAiCompatible({ env, db }: EngineContext): Promise<EvalEngine> {
	// One model serves every tier: the eval measures an engine, not a tier mapping.
	const model = required(env, 'STOCKPOT_EVAL_OPENAI_MODEL')

	const upstream = v.parse(openAiCompatibleSettings, {
		baseUrl: required(env, 'STOCKPOT_EVAL_OPENAI_BASE_URL'),
		apiKey: optional(env, 'STOCKPOT_EVAL_OPENAI_KEY'),
		models: { fast: model, standard: model, deep: model },
	})

	const proxy = recordingProxy(upstream.baseUrl ?? '')
	const settings = { ...upstream, baseUrl: proxy.url }

	return {
		engine: createOpenAiCompatibleEngine({ db, settings: () => settings }),
		outgoing: proxy.outgoing,
		close: proxy.close,
	}
}

export const evalEngines = {
	'agent-command': agentCommand,
	'openai-compatible': openAiCompatible,
} as const

export type EvalEngineId = keyof typeof evalEngines

export function isEvalEngineId(id: string): id is EvalEngineId {
	return Object.hasOwn(evalEngines, id)
}

export async function createEvalEngine(
	id: EvalEngineId,
	context: EngineContext,
): Promise<EvalEngine> {
	return evalEngines[id](context)
}
