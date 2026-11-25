// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { describe, expect, it } from 'bun:test'

import {
	formatDuration,
	parseCalls,
	percentile,
	renderMarkdown,
	summarize,
	type CallRecord,
	type EvalReport,
} from './report'

function call(overrides: Partial<CallRecord>): CallRecord {
	return {
		noteId: 'note',
		task: 'explain',
		format: 'technology',
		depth: 1,
		elapsedMs: 1000,
		error: null,
		checks: [],
		answer: null,
		...overrides,
	}
}

const passed = { check: 'schema', passed: true, detail: null } as const

const filler = { check: 'filler', passed: false, detail: '"delve into"' } as const

const calls = [
	call({ noteId: 'a', task: 'suggest', format: 'suggestion', elapsedMs: 300, checks: [passed] }),
	call({ noteId: 'a', elapsedMs: 10_000, checks: [passed], answer: { sense: 'the runtime' } }),
	call({ noteId: 'b', task: 'suggest', format: 'suggestion', elapsedMs: 900, error: 'timeout' }),
	call({ noteId: 'b', elapsedMs: 30_000, checks: [passed, filler], answer: { sense: 'x' } }),
]

const report: EvalReport = {
	stopped: null,
	engine: 'fake',
	language: 'en',
	startedAt: '2026-11-19T08:00:00.000Z',
	models: { fast: 'gemini-2.5-flash-lite', standard: 'gemini-2.5-flash', deep: null },
	timeoutsMs: { suggest: 10_000, explain: 180_000, research: 900_000 },
	notes: [
		{ id: 'a', text: 'bun', source: 'owner', private: false, format: 'technology', local: false },
		{
			id: 'b',
			text: 'a | b',
			source: 'composed',
			private: true,
			format: 'technology',
			local: true,
		},
	],
	calls,
	summary: summarize(calls),
}

describe('the eval report', () => {
	describe('percentile', () => {
		it.each([
			[50, 300],
			[95, 1000],
			[100, 1000],
		])('takes the nearest rank for p%p', (p, expected) => {
			expect(percentile([1000, 300, 200, 400], p)).toBe(expected)
		})

		it('is null without values', () => {
			expect(percentile([], 95)).toBeNull()
		})
	})

	describe('summarize', () => {
		it('counts pass rate and errors per format, and latency of the answered calls', () => {
			expect(report.summary.byFormat).toEqual({
				suggestion: { calls: 2, errors: 1, passed: 1, passRate: 0.5, p50Ms: 300, p95Ms: 300 },
				technology: { calls: 2, errors: 0, passed: 1, passRate: 0.5, p50Ms: 10_000, p95Ms: 30_000 },
			})
		})

		it('counts failures per check', () => {
			expect(report.summary.byCheck).toEqual({
				schema: { applied: 3, passed: 3, failed: 0, unverifiable: 0, passRate: 1 },
				filler: { applied: 1, passed: 0, failed: 1, unverifiable: 0, passRate: 0 },
			})
		})
	})

	describe('level 2', () => {
		const second = call({
			noteId: 'a',
			depth: 2,
			checks: [passed, { check: 'repeats', passed: false, detail: 'repeats "one two"' }],
		})

		const withSecond = [...calls, second]

		it('groups a level-2 card apart from level 1, so level-1 numbers stay as they were', () => {
			const { byFormat, byCheck } = summarize(withSecond)

			expect(byFormat.technology).toMatchObject({ calls: 2 })
			expect(byFormat['technology level 2']).toMatchObject({ calls: 1, passed: 0 })
			expect(byCheck.repeats).toMatchObject({ applied: 1, failed: 1, passRate: 0 })
		})

		it('names the group in the report and its failures', () => {
			const markdown = renderMarkdown({
				...report,
				calls: withSecond,
				summary: summarize(withSecond),
			})

			expect(markdown).toContain('| technology level 2 | 1 | 0% |')
			expect(markdown).toContain('| a | technology level 2 | repeats | repeats "one two" |')
		})

		it('reads a line written before level 2 existed as level 1', () => {
			const { depth: _depth, ...old } = calls[1] ?? call({})

			expect(parseCalls(`${JSON.stringify(old)}\n`)).toMatchObject([{ noteId: 'a', depth: 1 }])
			expect(parseCalls(`${JSON.stringify(second)}\n`)).toMatchObject([{ depth: 2 }])
		})
	})

	describe('formatDuration', () => {
		it.each([
			[850, '850 ms'],
			[12_340, '12.3 s'],
			[252_000, '4.2 min'],
			[null, '—'],
		])('writes %p ms as %p', (ms, text) => {
			expect(formatDuration(ms)).toBe(text)
		})
	})

	describe('renderMarkdown', () => {
		const markdown = renderMarkdown(report)

		it('has a row per format with its pass rate and latency', () => {
			expect(markdown).toContain('| technology | 2 | 50% | 2 | 0 | 10.0 s | 30.0 s |')
			expect(markdown).toContain('| suggestion | 2 | 50% | 1 | 1 | 300 ms | 300 ms |')
		})

		it('records the model of each tier and the timeout of each task', () => {
			expect(markdown).toContain(
				'Models: fast `gemini-2.5-flash-lite`, standard `gemini-2.5-flash`, deep not set. Timeouts: suggest 10.0 s, explain 3.0 min, research 15.0 min.',
			)
		})

		it('says when the engine picks its own models', () => {
			expect(renderMarkdown({ ...report, models: null })).toContain(
				'Models: the engine picks the model for each tier.',
			)
		})

		it('lists every failure and error', () => {
			expect(markdown).toContain('| b | technology | filler | "delve into" |')
			expect(markdown).toContain('| b | suggestion | error | timeout |')
		})
	})

	describe('parseCalls', () => {
		it('reads back the calls a run appended', () => {
			const lines = calls.map((saved) => `${JSON.stringify(saved)}\n`).join('')

			expect(parseCalls(lines)).toEqual(calls)
		})
	})

	describe('a stopped run', () => {
		it('says why it stopped and how many calls it covers', () => {
			const markdown = renderMarkdown({ ...report, stopped: 'the engine rejected its key' })

			expect(markdown).toContain(
				'**Stopped early:** the engine rejected its key. The report covers the 4 calls made before that.',
			)
		})
	})
})
