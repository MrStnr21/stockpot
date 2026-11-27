// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { describe, expect, it } from 'bun:test'

import { en } from '#/lib/i18n/en'

import type { EngineId } from '../shared/engines'
import type { EngineOverview } from '../shared/types'
import { engineSummary } from './engine-view'

const strings = en.settings.engines

function engine(id: EngineId, state: EngineOverview['state']): EngineOverview {
	return {
		id,
		configured: state !== 'not_set_up',
		state,
		lastCallAt: null,
		lastOutcome: null,
		today: { suggestions: 0, cards: 0 },
	}
}

describe('engineSummary', () => {
	it('names the engine that needs attention first', () => {
		expect(
			engineSummary(
				[
					engine('agent-command', 'failing'),
					engine('gemini', 'working'),
					engine('openai-compatible', 'key_rejected'),
				],
				strings,
			),
		).toBe('OpenAI-compatible needs attention')
	})

	it('names the first working engine in display order', () => {
		expect(
			engineSummary(
				[
					engine('agent-command', 'working'),
					engine('gemini', 'working'),
					engine('openai-compatible', 'limited'),
				],
				strings,
			),
		).toBe('Gemini works')
	})

	it('says when no engine is set up', () => {
		expect(
			engineSummary(
				[
					engine('agent-command', 'not_set_up'),
					engine('gemini', 'not_set_up'),
					engine('openai-compatible', 'not_set_up'),
				],
				strings,
			),
		).toBe('Not set up')
	})

	it('says when the set-up engines are not tested yet', () => {
		expect(
			engineSummary(
				[
					engine('agent-command', 'untested'),
					engine('gemini', 'not_set_up'),
					engine('openai-compatible', 'untested'),
				],
				strings,
			),
		).toBe('Not tested yet')
	})
})
