// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { describe, expect, it } from 'bun:test'
import { ThinkingLevel } from '@google/genai'

import { suggestionThinking } from './gemini-thinking'

describe('suggestionThinking', () => {
	it.each(['gemini-3.1-flash-lite', 'gemini-3-flash-preview', 'models/gemini-3.5-flash'])(
		'gives %s the minimal thinking level',
		(model) => {
			expect(suggestionThinking(model)).toEqual({ thinkingLevel: ThinkingLevel.MINIMAL })
		},
	)

	it.each(['gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-2.5-flash-preview-09-2025'])(
		'turns thinking off on %s with a zero budget',
		(model) => {
			expect(suggestionThinking(model)).toEqual({ thinkingBudget: 0 })
		},
	)

	it.each(['gemini-2.5-pro', 'gemini-2.0-flash', 'gemini-flash-latest', 'gemma-3-27b-it'])(
		'gives %s no thinking config',
		(model) => {
			expect(suggestionThinking(model)).toBeUndefined()
		},
	)
})
