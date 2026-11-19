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
import type { Engine } from '#/server/engines/contract'

import { parseFillerPhrases } from './checks'
import {
	createEvalEngine,
	evalEngines,
	isEvalEngineId,
	type EngineContext,
	type EvalEnv,
} from './engines'
import { runEval, type EvalRun } from './evaluate'
import { loadNotes } from './notes'
import { renderMarkdown, renderScoreSheet, summarize, type EvalReport } from './report'

export const usage =
	'Usage: bun run eval -- --engine <id> [--notes <file>] [--limit <n>] [--language <code>] [--out <dir>]'

const positiveNumber = v.pipe(
	v.string(),
	v.regex(/^[1-9]\d*$/u, 'Use a positive number'),
	v.transform(Number),
)

const languageCode = v.pipe(v.string(), v.regex(/^[a-z]{2}$/u, 'Use an ISO 639-1 code'))

const engineHint = `Use one of ${Object.keys(evalEngines).join(', ')}`

const argsSchema = v.strictObject({
	engine: v.pipe(v.string(), v.guard(isEvalEngineId, engineHint)),
	notes: v.optional(v.string(), join(import.meta.dir, 'notes.jsonl')),
	limit: v.optional(positiveNumber),
	language: v.optional(languageCode, 'en'),
	out: v.optional(v.string()),
})

export type EvalArgs = v.InferOutput<typeof argsSchema>

/** Reads `--name value` pairs; a bare `--`, as `bun run` may pass on, is skipped. */
export function parseArgs(args: readonly string[]): EvalArgs {
	const tokens = args.filter((token) => token !== '--')

	const pairs = Array.from({ length: Math.ceil(tokens.length / 2) }, (_, index) => {
		const name = tokens.at(index * 2) ?? ''
		const value = tokens.at(index * 2 + 1)

		if (!name.startsWith('--') || value === undefined) {
			throw new Error(usage)
		}

		return [name.slice(2), value]
	})

	const result = v.safeParse(argsSchema, Object.fromEntries(pairs))

	if (!result.success) {
		const issues = result.issues.map((issue) => `--${v.getDotPath(issue) ?? ''}: ${issue.message}`)

		throw new Error([...issues, usage].join('\n'))
	}

	return result.output
}

export interface MainOptions {
	readonly env: EvalEnv
	readonly createEngine?: (id: EvalArgs['engine'], context: EngineContext) => Engine
	readonly checkLinks?: EvalRun['checkLinks']
	readonly now?: () => number
}

const migrationsFolder = join(import.meta.dir, '../src/server/db/migrations')

/** Runs the eval the arguments describe and writes the report; returns the report's folder. */
export async function main(args: readonly string[], options: MainOptions): Promise<string> {
	const { engine: engineId, notes: notesFile, limit, language, out } = parseArgs(args)
	const publicFile = resolve(notesFile)
	const notes = await loadNotes({ publicFile, localDir: join(dirname(publicFile), 'local') })
	const selected = notes.slice(0, limit)
	const rubric = await file(join(import.meta.dir, 'rubric.md')).text()
	const { sqlite, db } = await openDatabase({ path: ':memory:', migrationsFolder })
	const engine = (options.createEngine ?? createEvalEngine)(engineId, { env: options.env, db })
	const startedAt = new Date()

	const calls = await runEval({
		engine,
		notes: selected,
		language,
		fillerPhrases: parseFillerPhrases(rubric, language),
		...(options.checkLinks && { checkLinks: options.checkLinks }),
		...(options.now && { now: options.now }),
	})

	sqlite.close()

	const report: EvalReport = {
		engine: engineId,
		language,
		startedAt: startedAt.toISOString(),
		notes: selected.map((note) => ({
			id: note.id,
			text: note.text,
			source: note.source,
			private: note.private,
			format: note.expected.format,
		})),
		calls,
		summary: summarize(calls),
	}

	const stamp = report.startedAt.slice(0, 19).replaceAll(':', '-')
	const folder = resolve(out ?? join(import.meta.dir, 'local', 'reports', `${stamp}-${engineId}`))

	await write(join(folder, 'report.md'), renderMarkdown(report))
	await write(join(folder, 'report.json'), `${JSON.stringify(report, null, '\t')}\n`)
	await write(join(folder, 'score-sheet.md'), renderScoreSheet(report))

	return folder
}

if (import.meta.main) {
	try {
		const folder = await main(argv.slice(2), { env })

		await write(stdout, `The report is in ${folder}\n`)
	} catch (error) {
		await write(stderr, `${error instanceof Error ? error.message : String(error)}\n`)
		// oxlint-disable-next-line no-undef -- process.exit is allowed by docs/guidelines/runtime.md; the app config declares browser globals only.
		process.exit(1)
	}
}
