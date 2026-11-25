// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

/*
 * The eval runner's command line (evals/README.md). It runs the eval set through one engine and writes
 * the report and the manual score sheet. It is a tool, not a unit test: it calls a real engine.
 */
import { argv, env, file, stderr, stdout, write } from 'bun'
import { dirname, join, resolve } from 'node:path'
import * as v from 'valibot'

import { openDatabase } from '#/server/db/client'
import { defaultTimeoutMs } from '#/server/engines/contract'

import { parseFillerPhrases } from './checks'
import {
	createEvalEngine,
	evalEngines,
	isEvalEngineId,
	type EngineContext,
	type EvalEngine,
	type EvalEnv,
} from './engines'
import { runEval, type EvalRun } from './evaluate'
import { loadNotes, sampleOrder } from './notes'
import { parseCalls, renderMarkdown, summarize, type CallRecord, type EvalReport } from './report'
import { renderScoreSheet } from './score-sheet'

export const usage = [
	'Usage: bun run eval -- --engine <id> [--notes <file>] [--limit <n>] [--language <code>]',
	'  [--model <tier>=<id>]... [--suggest-timeout <ms>] [--out <dir>] [--deeper]',
].join('\n')

const positiveNumber = v.pipe(
	v.string(),
	v.regex(/^[1-9]\d*$/u, 'Use a positive number'),
	v.transform(Number),
)

const languageCode = v.pipe(v.string(), v.regex(/^[a-z]{2}$/u, 'Use an ISO 639-1 code'))

const engineHint = `Use one of ${Object.keys(evalEngines).join(', ')}`

const tierModel = v.pipe(
	v.string(),
	v.regex(
		/^(?:fast|standard|deep)=\S{1,200}$/u,
		'Use <tier>=<model id>, with the tier fast, standard or deep',
	),
)

/** Each `tier=model` as an entry; a model ID may hold `=`, so it splits at the first one only. */
function tierModels(entries: readonly string[]): Record<string, string> {
	return Object.fromEntries(
		entries.map((entry) => {
			const at = entry.indexOf('=')

			return [entry.slice(0, at), entry.slice(at + 1)] as const
		}),
	)
}

const tierModelsSchema = v.object({
	fast: v.optional(v.string()),
	standard: v.optional(v.string()),
	deep: v.optional(v.string()),
})

// Every `--model` given, as the model of each tier; a tier given twice takes the last.
const modelsArg = v.pipe(
	v.array(tierModel),
	v.transform((entries) => tierModels(entries)),
	tierModelsSchema,
)

const optionsSchema = v.strictObject({
	engine: v.pipe(v.string(), v.guard(isEvalEngineId, engineHint)),
	notes: v.optional(v.string(), join(import.meta.dir, 'notes.jsonl')),
	limit: v.optional(positiveNumber),
	language: v.optional(languageCode, 'en'),
	model: v.optional(modelsArg, []),
	'suggest-timeout': v.optional(positiveNumber),
	out: v.optional(v.string()),
	deeper: v.optional(v.literal(true)),
})

const argsSchema = v.pipe(
	optionsSchema,
	v.transform(({ model, 'suggest-timeout': suggestTimeoutMs, ...rest }) => ({
		...rest,
		models: model,
		...(suggestTimeoutMs !== undefined && { suggestTimeoutMs }),
	})),
)

// The environment equivalent of `--suggest-timeout`; the option wins when both are given.
const envSchema = v.object({
	STOCKPOT_EVAL_SUGGEST_TIMEOUT_MS: v.optional(positiveNumber),
})

export type EvalArgs = v.InferOutput<typeof argsSchema>

function issueLines(issues: readonly v.BaseIssue<unknown>[], prefix: string): string[] {
	return issues.map((issue) => {
		const name = v.getDotPath(issue)?.split('.').at(0) ?? ''

		return `${prefix}${name}: ${issue.message}`
	})
}

function suggestTimeoutFromEnv(environment: EvalEnv): number | undefined {
	const value = environment.STOCKPOT_EVAL_SUGGEST_TIMEOUT_MS?.trim()

	const result = v.safeParse(envSchema, {
		STOCKPOT_EVAL_SUGGEST_TIMEOUT_MS: value === '' ? undefined : value,
	})

	if (!result.success) {
		throw new Error([...issueLines(result.issues, ''), usage].join('\n'))
	}

	return result.output.STOCKPOT_EVAL_SUGGEST_TIMEOUT_MS
}

/**
 * Reads `--name value` pairs, `--model` as often as it is given, and the `--deeper` flag, which takes
 * no value; a bare `--`, as `bun run` may pass on, is skipped. The environment gives the suggestion
 * timeout when the command line does not.
 */
export function parseArgs(args: readonly string[], environment: EvalEnv = {}): EvalArgs {
	const tokens = args.filter((token) => token !== '--' && token !== '--deeper')
	const deeper = args.includes('--deeper')

	const pairs = Array.from({ length: Math.ceil(tokens.length / 2) }, (_, index) => {
		const name = tokens.at(index * 2) ?? ''
		const value = tokens.at(index * 2 + 1)

		if (!name.startsWith('--') || value === undefined) {
			throw new Error(usage)
		}

		return [name.slice(2), value]
	})

	const models = pairs.filter(([name]) => name === 'model').map(([, value]) => value)
	const single = pairs.filter(([name]) => name !== 'model')

	const result = v.safeParse(argsSchema, {
		...Object.fromEntries(single),
		...(deeper && { deeper: true }),
		...(models.length > 0 && { model: models }),
	})

	if (!result.success) {
		throw new Error([...issueLines(result.issues, '--'), usage].join('\n'))
	}

	const { output } = result
	const suggestTimeoutMs = output.suggestTimeoutMs ?? suggestTimeoutFromEnv(environment)

	return suggestTimeoutMs === undefined ? output : { ...output, suggestTimeoutMs }
}

export interface MainOptions {
	readonly env: EvalEnv
	readonly createEngine?: (id: EvalArgs['engine'], context: EngineContext) => Promise<EvalEngine>
	readonly checkLinks?: EvalRun['checkLinks']
	readonly now?: () => number
	readonly wait?: EvalRun['wait']
	readonly signal?: AbortSignal
}

const migrationsFolder = join(import.meta.dir, '../src/server/db/migrations')

/** Runs the eval the arguments describe and writes the report; returns the report's folder. */
export async function main(args: readonly string[], options: MainOptions): Promise<string> {
	const parsed = parseArgs(args, options.env)

	const {
		engine: engineId,
		notes: notesFile,
		limit,
		language,
		models: overrides,
		out,
		deeper,
	} = parsed

	const suggest = parsed.suggestTimeoutMs ?? defaultTimeoutMs.suggest
	const timeoutsMs = { ...defaultTimeoutMs, suggest }
	const publicFile = resolve(notesFile)
	const notes = await loadNotes({ publicFile, localDir: join(dirname(publicFile), 'local') })
	const rubric = await file(join(import.meta.dir, 'rubric.md')).text()
	const { sqlite, db } = await openDatabase({ path: ':memory:', migrationsFolder })
	const createEngine = options.createEngine ?? createEvalEngine
	const context = { env: options.env, db, models: overrides }
	const { engine, models, outgoing, close } = await createEngine(engineId, context)
	const startedAt = new Date().toISOString()
	const stamp = startedAt.slice(0, 19).replaceAll(':', '-')
	const folder = resolve(out ?? join(import.meta.dir, 'local', 'reports', `${stamp}-${engineId}`))
	const callsFile = join(folder, 'calls.jsonl')

	// Each call is on disk before the next one starts, so Ctrl-C or a crash loses nothing.
	await write(callsFile, '')

	const calls = file(callsFile).writer()

	async function save(call: CallRecord): Promise<void> {
		await calls.write(`${JSON.stringify(call)}\n`)
		await calls.flush()
	}

	const { stopped } = await runEval({
		engine,
		outgoing,
		notes: sampleOrder(notes),
		language,
		fillerPhrases: parseFillerPhrases(rubric, language),
		onCall: save,
		timeoutsMs,
		...(limit !== undefined && { maxCalls: limit }),
		...(deeper === true && { deeper }),
		...(options.checkLinks && { checkLinks: options.checkLinks }),
		...(options.now && { now: options.now }),
		...(options.wait && { wait: options.wait }),
		...(options.signal && { signal: options.signal }),
	})

	await calls.end()
	await close()
	sqlite.close()

	const saved = parseCalls(await file(callsFile).text())
	const reached = new Set(saved.map(({ noteId }) => noteId))

	const report: EvalReport = {
		stopped,
		engine: engineId,
		language,
		startedAt,
		models,
		timeoutsMs,
		notes: notes
			.filter(({ id }) => reached.has(id))
			.map((note) => ({
				id: note.id,
				text: note.text,
				source: note.source,
				private: note.private,
				format: note.expected.format,
				local: note.local,
			})),
		calls: saved,
		summary: summarize(saved),
	}

	await write(join(folder, 'report.md'), renderMarkdown(report))
	await write(join(folder, 'report.json'), `${JSON.stringify(report, null, '\t')}\n`)
	await write(join(folder, 'score-sheet.md'), renderScoreSheet(report))

	return folder
}

if (import.meta.main) {
	const interrupt = new AbortController()

	// The first Ctrl-C stops the run and writes the report so far; a second one exits at once.
	process.once('SIGINT', () => {
		interrupt.abort(new Error('stopped with Ctrl-C'))
	})

	try {
		const folder = await main(argv.slice(2), { env, signal: interrupt.signal })

		await write(stdout, `The report is in ${folder}\n`)
	} catch (error) {
		await write(stderr, `${error instanceof Error ? error.message : String(error)}\n`)
		process.exit(1)
	}
}
