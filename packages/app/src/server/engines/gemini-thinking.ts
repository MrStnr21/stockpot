// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

/*
 * How much the Gemini engine lets a model think (docs/engines.md, "The Gemini engine"), apart from
 * the engine so that it stays a pure function with its own spec. Only `gemini.ts` uses it.
 */
import { ThinkingLevel, type ThinkingConfig } from '@google/genai'

const generation = /^(?:models\/)?gemini-(?<major>\d+)(?:\.(?<minor>\d+))?-(?<family>[a-z]+)/u

/**
 * The thinking config for a suggestion, which should answer with as little thinking as the model
 * allows. Gemini 3 takes `thinkingLevel`; Gemini 2.5 takes `thinkingBudget` instead, where 0 turns
 * thinking off on Flash and Flash-Lite, while Pro cannot turn it off and so gets no config. A model
 * this does not recognize gets none either, rather than a field it may reject.
 */
export function suggestionThinking(model: string): ThinkingConfig | undefined {
	const { major, minor, family } = generation.exec(model)?.groups ?? {}

	if (Number(major) >= 3) {
		return { thinkingLevel: ThinkingLevel.MINIMAL }
	}

	if (major === '2' && minor === '5' && family === 'flash') {
		return { thinkingBudget: 0 }
	}

	return undefined
}
