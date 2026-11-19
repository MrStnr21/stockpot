// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { $, file, write } from 'bun'
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { briefCardFactory } from '#tests/factories/cards'
import { evalNoteFactory } from '#tests/factories/eval-notes'
import type * as v from 'valibot'

import {
	parseOutput,
	type Engine,
	type EngineInput,
	type EngineResult,
	type OutputFormat,
	type Redacted,
} from '#/server/engines/contract'

import type { EvalReport } from './report'
import { main, parseArgs } from './run'

async function answerBrief<TSchema extends v.GenericSchema>(
	input: Redacted<EngineInput & { readonly output: OutputFormat<TSchema> }>,
): Promise<EngineResult<v.InferOutput<TSchema>>> {
	const answer =
		input.task === 'suggest'
			? { categories: ['brief'], senses: [], language: 'en' }
			: briefCardFactory.build({ sources: [], uncertain: true })

	return { output: parseOutput(input.output, answer), engine: 'fake', model: null, elapsedMs: 0 }
}

/** An engine that suggests Other and writes an uncertain brief card for every note, at once. */
function briefEngine(): Engine {
	return { id: 'fake', suggest: answerBrief, explain: answerBrief, research: answerBrief }
}

function lines(notes: readonly object[]): string {
	return notes.map((note) => `${JSON.stringify(note)}\n`).join('')
}

async function runOn(notesFolder: string, out: string): Promise<EvalReport> {
	const args = ['--engine', 'agent-command', '--notes', join(notesFolder, 'notes.jsonl')]

	await main([...args, '--out', out], { env: {}, createEngine: briefEngine, now: () => 0 })

	return readReport(out)
}

async function readReport(folder: string): Promise<EvalReport> {
	// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- SAFETY: the runner wrote this report in the same test.
	return (await file(join(folder, 'report.json')).json()) as EvalReport
}

describe('the eval command', () => {
	describe('parseArgs', () => {
		it('fills in the defaults and skips a bare --', () => {
			expect(parseArgs(['--', '--engine', 'agent-command'])).toEqual({
				engine: 'agent-command',
				notes: join(import.meta.dir, 'notes.jsonl'),
				language: 'en',
			})
		})

		it.each([
			[['--engine', 'nope']],
			[['--engine', 'agent-command', '--limit', '0']],
			[['--engine', 'agent-command', '--colour', 'red']],
			[['--engine']],
		])('rejects %p with the usage', (args) => {
			expect(() => parseArgs(args)).toThrow('Usage: bun run eval')
		})
	})

	describe('main', () => {
		const folder = join(tmpdir(), `stockpot-eval-run-${crypto.randomUUID()}`)
		const brief = { format: 'brief' as const, alsoAccept: [], senses: [], uncertain: true }
		const publicNotes = evalNoteFactory.buildList(2, { expected: brief })
		const localNote = evalNoteFactory.build({ id: 'local-note', expected: brief })

		beforeAll(async () => {
			await write(join(folder, 'with-local', 'notes.jsonl'), lines(publicNotes))
			await write(join(folder, 'with-local', 'local', 'mine.jsonl'), lines([localNote]))
			await write(join(folder, 'public-only', 'notes.jsonl'), lines(publicNotes))
		})

		afterAll(async () => {
			await $`rm -rf ${folder}`
		})

		it('includes the local notes when they are present', async () => {
			const report = await runOn(join(folder, 'with-local'), join(folder, 'out-local'))

			expect(report.notes.map(({ id }) => id)).toEqual([
				...publicNotes.map(({ id }) => id),
				'local-note',
			])
		})

		it('runs the public notes alone when there are no local ones', async () => {
			const report = await runOn(join(folder, 'public-only'), join(folder, 'out-public'))

			expect(report.notes.map(({ id }) => id)).toEqual(publicNotes.map(({ id }) => id))
		})

		it('writes the report, its pass rates and the score sheet', async () => {
			const out = join(folder, 'out-files')
			const report = await runOn(join(folder, 'public-only'), out)
			const markdown = await file(join(out, 'report.md')).text()
			const sheet = await file(join(out, 'score-sheet.md')).text()

			expect(report.summary.byFormat).toMatchObject({
				suggestion: { calls: 2, passRate: 1 },
				brief: { calls: 2, passRate: 1, p95Ms: 0 },
			})

			expect(markdown).toContain('| brief | 2 | 0 | 100% |')
			expect(sheet).toContain('| Note | Source | Text |')
		})
	})
})
