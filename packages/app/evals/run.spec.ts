// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { $, file, write } from 'bun'
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { briefCardFactory } from '#tests/factories/cards'
import { evalNoteFactory } from '#tests/factories/eval-notes'
import { fakeEngine, type Reply } from '#tests/setup/fake-engine'

import { EngineError, type EngineInput, type Redacted } from '#/server/engines/contract'

import type { EvalEngine } from './engines'
import type { EvalReport } from './report'
import { main, parseArgs } from './run'

function briefAnswer(input: Redacted<EngineInput>): Reply {
	const answer =
		input.task === 'suggest'
			? { categories: ['brief'], senses: [], language: 'en' }
			: briefCardFactory.build({ sources: [], uncertain: true })

	return { delayMs: 0, answer }
}

async function closeNothing(): Promise<void> {
	// The fake engine holds nothing open.
}

/** An engine that suggests Other and writes an uncertain brief card, until `failAfter` calls. */
function briefEvalEngine(failAfter = Number.POSITIVE_INFINITY): () => Promise<EvalEngine> {
	return async () => {
		let made = 0

		function reply(input: Redacted<EngineInput>): Reply {
			made += 1

			return made > failAfter ? { delayMs: 0, answer: rejected } : briefAnswer(input)
		}

		return {
			engine: fakeEngine({ clock: { ms: 0 }, received: [], reply }),
			models: null,
			outgoing: null,
			close: closeNothing,
		}
	}
}

const rejected = new EngineError({ kind: 'auth' }, 'Rejected')

function lines(notes: readonly object[]): string {
	return notes.map((note) => `${JSON.stringify(note)}\n`).join('')
}

interface RunOnOptions {
	readonly extra?: readonly string[]
	readonly failAfter?: number
}

async function runOn(
	notesFolder: string,
	out: string | null,
	{ extra = [], failAfter = Number.POSITIVE_INFINITY }: RunOnOptions = {},
): Promise<{ folder: string; report: EvalReport }> {
	const notes = ['--notes', join(notesFolder, 'notes.jsonl'), ...extra]
	const args = ['--engine', 'agent-command', ...notes, ...(out === null ? [] : ['--out', out])]
	const createEngine = briefEvalEngine(failAfter)
	const folder = await main(args, { env: {}, createEngine, now: () => 0 })

	return { folder, report: await readReport(folder) }
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
				models: {},
			})
		})

		it('takes a model for each tier from every --model, and the suggestion timeout', () => {
			const args = ['--engine', 'gemini', '--model', 'fast=gemini-2.5-flash-lite']
			const more = ['--model', 'deep=tuned=v2', '--suggest-timeout', '10000']

			expect(parseArgs([...args, ...more])).toMatchObject({
				models: { fast: 'gemini-2.5-flash-lite', deep: 'tuned=v2' },
				suggestTimeoutMs: 10_000,
			})
		})

		describe('with STOCKPOT_EVAL_SUGGEST_TIMEOUT_MS', () => {
			const env = { STOCKPOT_EVAL_SUGGEST_TIMEOUT_MS: '8000' }

			it('takes the suggestion timeout from it', () => {
				expect(parseArgs(['--engine', 'gemini'], env)).toMatchObject({ suggestTimeoutMs: 8000 })
			})

			it('lets --suggest-timeout win', () => {
				const args = ['--engine', 'gemini', '--suggest-timeout', '9000']

				expect(parseArgs(args, env)).toMatchObject({ suggestTimeoutMs: 9000 })
			})

			it('rejects a value that is not a positive number, naming the variable', () => {
				const invalid = { STOCKPOT_EVAL_SUGGEST_TIMEOUT_MS: '10s' }

				expect(() => parseArgs(['--engine', 'gemini'], invalid)).toThrow(
					'STOCKPOT_EVAL_SUGGEST_TIMEOUT_MS: Use a positive number',
				)
			})
		})

		it.each([
			[['--engine', 'nope']],
			[['--engine', 'agent-command', '--limit', '0']],
			[['--engine', 'agent-command', '--colour', 'red']],
			[['--engine']],
			[['--engine', 'gemini', '--model', 'turbo=gemini-2.5-flash']],
			[['--engine', 'gemini', '--model', 'gemini-2.5-flash']],
			[['--engine', 'gemini', '--model', 'fast=']],
			[['--engine', 'gemini', '--suggest-timeout', '1.5']],
		])('rejects %p with the usage', (args) => {
			expect(() => parseArgs(args)).toThrow('Usage: bun run eval')
		})

		it('names the option and the expected form of a bad --model', () => {
			expect(() => parseArgs(['--engine', 'gemini', '--model', 'turbo=x'])).toThrow(
				'--model: Use <tier>=<model id>, with the tier fast, standard or deep',
			)
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
			const { report } = await runOn(join(folder, 'with-local'), join(folder, 'out-local'))

			expect(report.notes.map(({ id }) => id)).toEqual([
				...publicNotes.map(({ id }) => id),
				'local-note',
			])
		})

		it('runs the public notes alone when there are no local ones', async () => {
			const { report } = await runOn(join(folder, 'public-only'), join(folder, 'out-public'))

			expect(report.notes.map(({ id }) => id)).toEqual(publicNotes.map(({ id }) => id))
		})

		it('stops after --limit engine calls, sampling local notes first', async () => {
			const { report } = await runOn(join(folder, 'with-local'), join(folder, 'out-limit'), {
				extra: ['--limit', '3'],
			})

			expect(report.calls.map(({ noteId, task }) => `${noteId} ${task}`)).toEqual([
				'local-note suggest',
				'local-note explain',
				`${publicNotes.at(0)?.id} suggest`,
			])
		})

		it('writes to a dated folder under evals/local/reports without --out', async () => {
			const { folder: written, report } = await runOn(join(folder, 'public-only'), null)

			await $`rm -rf ${written}`

			expect(written.startsWith(join(import.meta.dir, 'local', 'reports'))).toBe(true)
			expect(written.endsWith(`-agent-command`)).toBe(true)
			expect(report.notes.length).toBe(2)
		})

		it('keeps the calls made before the engine failed, and says why it stopped', async () => {
			const out = join(folder, 'out-failed')
			const { report } = await runOn(join(folder, 'public-only'), out, { failAfter: 2 })
			const saved = await file(join(out, 'calls.jsonl')).text()

			expect(report.stopped).toBe('the engine rejected its key or login (auth)')
			expect(saved.trim().split('\n').length).toBe(3)
			expect(await file(join(out, 'report.md')).text()).toContain('**Stopped early:**')
		})

		it('records the timeouts it ran with', async () => {
			const out = join(folder, 'out-timeouts')

			const { report } = await runOn(join(folder, 'public-only'), out, {
				extra: ['--suggest-timeout', '10000'],
			})

			expect(report).toMatchObject({
				models: null,
				timeoutsMs: { suggest: 10_000, explain: 180_000, research: 900_000 },
			})
		})

		it('writes the report, its pass rates and the score sheet', async () => {
			const out = join(folder, 'out-files')
			const { report } = await runOn(join(folder, 'public-only'), out)
			const markdown = await file(join(out, 'report.md')).text()
			const sheet = await file(join(out, 'score-sheet.md')).text()

			expect(report.summary.byFormat).toMatchObject({
				suggestion: { calls: 2, passRate: 1 },
				brief: { calls: 2, passRate: 1, p95Ms: 0 },
			})

			expect(markdown).toContain('| brief | 2 | 100% | 2 | 0 |')
			expect(sheet).toContain('| Note | Source | Text |')
		})
	})
})
