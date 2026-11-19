// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

/*
 * How the Gemini engine reads a response (docs/engines.md, "The Gemini engine"): the answer's text,
 * the usage it reports and the pages a grounded answer searched or opened. Only `gemini.ts` uses it.
 */
import { FinishReason, UrlRetrievalStatus, type GenerateContentResponse } from '@google/genai'

import { EngineError } from './contract'
import type { RunReport } from './runs'

function invalid(issue: string) {
	return new EngineError({ kind: 'invalid', issues: [issue] }, issue)
}

function plus(total: number | null, amount: number | undefined) {
	return amount === undefined ? total : (total ?? 0) + amount
}

/** Adds a response's usage to the run; thinking is billed as output and tool prompts as input. */
export function addUsage(
	report: RunReport,
	{ modelVersion, usageMetadata }: GenerateContentResponse,
): void {
	const usage = usageMetadata ?? {}

	report.model = modelVersion ?? report.model
	report.inputTokens = plus(
		plus(report.inputTokens, usage.promptTokenCount),
		usage.toolUsePromptTokenCount,
	)
	report.outputTokens = plus(
		plus(report.outputTokens, usage.candidatesTokenCount),
		usage.thoughtsTokenCount,
	)
}

/** The answer's text, or `invalid` when the prompt was blocked or the answer stopped early. */
export function answerText(response: GenerateContentResponse): string {
	const candidate = response.candidates?.at(0)

	if (candidate === undefined) {
		const reason = response.promptFeedback?.blockReason ?? 'no reason given'

		throw invalid(`The prompt was blocked: ${reason}`)
	}

	const { finishReason } = candidate

	if (finishReason === FinishReason.MAX_TOKENS) {
		throw invalid('The answer was cut off at the token limit')
	}

	if (finishReason !== undefined && finishReason !== FinishReason.STOP) {
		throw invalid(`The answer stopped: ${finishReason}`)
	}

	const parts = candidate.content?.parts ?? []
	const text = parts.map((part) => (part.thought === true ? '' : (part.text ?? ''))).join('')

	if (text === '') {
		throw invalid('The answer is empty')
	}

	return text
}

interface Source {
	readonly title: string
	readonly uri: string
}

export interface Facts {
	readonly text: string
	readonly sources: readonly Source[]
}

/** The facts step's text with the pages it searched or opened, which the card may cite. */
export function readFacts(response: GenerateContentResponse, report: RunReport): Facts {
	const text = answerText(response)
	const candidate = response.candidates?.at(0)
	const grounding = candidate?.groundingMetadata

	report.searches = grounding?.webSearchQueries?.length ?? 0
	report.searchSuggestions = grounding?.searchEntryPoint?.renderedContent ?? null

	const searched = (grounding?.groundingChunks ?? []).flatMap(({ web }): Source[] =>
		web?.uri === undefined ? [] : [{ title: web.title ?? web.uri, uri: web.uri }],
	)

	const opened = (candidate?.urlContextMetadata?.urlMetadata ?? []).flatMap(
		({ retrievedUrl, urlRetrievalStatus }): Source[] => {
			const isOpened = urlRetrievalStatus === UrlRetrievalStatus.URL_RETRIEVAL_STATUS_SUCCESS

			return retrievedUrl === undefined || !isOpened
				? []
				: [{ title: retrievedUrl, uri: retrievedUrl }]
		},
	)

	return { text, sources: [...opened, ...searched] }
}
