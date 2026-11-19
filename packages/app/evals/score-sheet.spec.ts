// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { describe, expect, it } from 'bun:test'

import { summarize, type CallRecord, type EvalReport } from './report'
import { renderScoreSheet } from './score-sheet'

const card: CallRecord = {
	noteId: 'b',
	task: 'explain',
	format: 'technology',
	elapsedMs: 1000,
	error: null,
	checks: [],
	answer: { sense: 'x' },
}

const report: EvalReport = {
	stopped: null,
	engine: 'fake',
	language: 'en',
	startedAt: '2026-11-19T08:00:00.000Z',
	models: null,
	timeoutsMs: { suggest: 3000, explain: 180_000, research: 900_000 },
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
	calls: [card],
	summary: summarize([card]),
}

describe('renderScoreSheet', () => {
	it('has a row per note with blank scores and escaped text', () => {
		expect(renderScoreSheet(report)).toContain(
			String.raw`| b | composed | a \| b | technology | x |  |  |  |  |`,
		)
	})

	it('marks a note whose card gave no answer', () => {
		expect(renderScoreSheet(report)).toContain('| a | owner | bun | technology | no answer |')
	})
})
