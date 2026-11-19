// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

/*
 * The agent command engine (docs/engines.md, "The agent command"): runs the command-line agent the
 * owner configured in STOCKPOT_AGENT_COMMAND. The command is a template, so no agent is named here;
 * what it must print, and how it reports a usage limit or a login failure, is the contract on that
 * page. Each run gets a fresh empty working directory, and one run goes at a time.
 */
import { $, write } from 'bun'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as v from 'valibot'

import type { Db } from '#/server/db/client'

import { runProcess, splitWords, type ProcessExit } from './agent-process'
import {
	EngineError,
	parseJsonText,
	parseOutput,
	type Engine,
	type EngineInput,
	type JsonValue,
	type OutputFormat,
	type Redacted,
	type RunOptions,
} from './contract'
import { buildPrompt } from './prompt'
import { oneAtATime, recordRun, type RunReport } from './runs'
import type { EngineId } from './settings'

const engineId = 'agent-command' satisfies EngineId

const placeholderPattern = /\{(?<name>prompt_file|schema_file|schema|tier)\}/gu

const defaultGraceMs = 5000

// A limit reported without its reset time is assumed to last this long.
const defaultResetMs = 60 * 60_000

// How much of the agent's stderr an unrecognised failure carries into the job's error.
const stderrTail = 500

/** The template split into words; the placeholders are filled in per word, so a value never splits. */
export function parseCommandTemplate(template: string): string[] {
	const words = splitWords(template)

	if (words.length === 0) {
		throw new Error('The agent command is empty')
	}

	return words
}

interface AgentRun {
	readonly template: readonly string[]
	readonly input: Redacted<EngineInput>
	readonly options: RunOptions
	readonly graceMs: number
}

/** Runs the agent in a fresh empty working directory; its input files sit next to it, not in it. */
async function runAgent({ template, input, options, graceMs }: AgentRun): Promise<ProcessExit> {
	const created = await $`mktemp -d ${join(tmpdir(), 'stockpot-agent-XXXXXX')}`.quiet().text()
	const root = created.trim()

	try {
		const cwd = join(root, 'work')
		const schema = JSON.stringify(input.output.jsonSchema)
		const prompt = buildPrompt(input, { canSearch: true })
		const promptFile = join(root, 'prompt.md')
		const schemaFile = join(root, 'schema.json')
		const isPromptInFile = template.some((word) => word.includes('{prompt_file}'))

		const values = new Map([
			['prompt_file', promptFile],
			['schema_file', schemaFile],
			['schema', schema],
			['tier', options.tier],
		])

		const cmd = template.map((word) =>
			word.replaceAll(
				placeholderPattern,
				(match: string, name: string) => values.get(name) ?? match,
			),
		)

		await $`mkdir ${cwd}`.quiet()
		await write(schemaFile, schema)

		if (isPromptInFile) {
			await write(promptFile, prompt)
		}

		const { timeoutMs, signal } = options

		return await runProcess({
			cmd,
			cwd,
			stdin: isPromptInFile ? null : prompt,
			timeoutMs,
			signal,
			graceMs,
		})
	} finally {
		await $`rm -rf ${root}`.quiet()
	}
}

/** The JSON the agent printed, or `undefined` when stdout is not JSON. */
function printedJson(stdout: string): JsonValue | undefined {
	try {
		return parseJsonText(stdout)
	} catch {
		return undefined
	}
}

const limitSchema = v.object({ kind: v.literal('rate_limited'), resets_at: v.optional(v.string()) })

const loginSchema = v.object({ kind: v.literal('auth') })

const failureSchema = v.object({ error: v.variant('kind', [limitSchema, loginSchema]) })

/** The failure the agent reported with an `error` object on stdout, if it reported one. */
function reportedFailure(printed: JsonValue | undefined): EngineError | null {
	const result = v.safeParse(failureSchema, printed)

	if (!result.success) {
		return null
	}

	const { error } = result.output

	if (error.kind === 'auth') {
		return new EngineError({ kind: 'auth' }, 'The agent command reported a login failure')
	}

	const reported = new Date(error.resets_at ?? Number.NaN)
	const isKnown = !Number.isNaN(reported.getTime())
	const resetsAt = isKnown ? reported : new Date(Date.now() + defaultResetMs)

	return new EngineError(
		{ kind: 'rate_limited', resetsAt },
		'The agent command reported a usage limit',
	)
}

const amount = v.pipe(v.number(), v.minValue(0))

const count = v.pipe(amount, v.integer())

// Each field falls back to null, so a wrapper with odd or missing metadata still yields its answer.
const usageSchema = v.object({
	input_tokens: v.fallback(v.nullable(count), null),
	output_tokens: v.fallback(v.nullable(count), null),
	searches: v.fallback(v.nullable(count), null),
	cost_usd: v.fallback(v.nullable(amount), null),
})

const noUsage = { input_tokens: null, output_tokens: null, searches: null, cost_usd: null }

const modelSchema = v.fallback(v.nullable(v.string()), null)

const wrapperSchema = v.object({
	// The value came from JSON.parse, so whatever it holds is JSON.
	structured_output: v.custom<JsonValue>((value) => value !== undefined),
	model: modelSchema,
	usage: v.fallback(usageSchema, noUsage),
})

/** The answer itself, or a wrapper's `structured_output`, whose model and usage go to the report. */
function unwrap(printed: JsonValue, report: RunReport): JsonValue {
	const result = v.safeParse(wrapperSchema, printed)

	if (!result.success) {
		return printed
	}

	const { structured_output: answer, model, usage } = result.output

	report.model = model
	report.inputTokens = usage.input_tokens
	report.outputTokens = usage.output_tokens
	report.searches = usage.searches
	report.costUsd = usage.cost_usd

	return answer
}

function readAnswer<TSchema extends v.GenericSchema>(
	output: OutputFormat<TSchema>,
	{ exitCode, stdout, stderr }: ProcessExit,
	report: RunReport,
): v.InferOutput<TSchema> {
	const printed = printedJson(stdout)
	const failure = reportedFailure(printed)

	if (failure !== null) {
		throw failure
	}

	if (exitCode !== 0) {
		const detail = stderr.trim().slice(-stderrTail)
		const status = `The agent command exited with status ${exitCode}`

		throw new Error(detail === '' ? status : `${status}: ${detail}`)
	}

	return parseOutput(output, unwrap(printed ?? parseJsonText(stdout), report))
}

export interface AgentCommandOptions {
	/** The owner's command template, `config.agentCommand`. */
	readonly command: string
	readonly db: Db
	/** How long the agent gets to stop after SIGINT, and again after SIGTERM. Default 5 seconds. */
	readonly graceMs?: number
}

/** The agent command engine. Throws when the template cannot be parsed. */
export function createAgentCommandEngine({
	command,
	db,
	graceMs = defaultGraceMs,
}: AgentCommandOptions): Engine {
	const template = parseCommandTemplate(command)
	const inTurn = oneAtATime()

	async function run<TSchema extends v.GenericSchema>(
		input: Redacted<EngineInput & { readonly output: OutputFormat<TSchema> }>,
		options: RunOptions,
	) {
		const record = { db, engine: engineId, task: input.task, jobId: options.jobId ?? null }

		return inTurn(options.signal, async () =>
			recordRun(record, async (report) => {
				const exit = await runAgent({ template, input, options, graceMs })

				return readAnswer(input.output, exit, report)
			}),
		)
	}

	return { id: engineId, suggest: run, explain: run, research: run }
}
