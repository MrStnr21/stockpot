// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

/*
 * What each step of the Gemini research loop adds to the call's prompt (docs/engines.md, "The Gemini
 * engine"). The prompt itself comes from `buildPrompt`, so a private note's steps carry its term alone.
 * Only `gemini-research.ts` uses it.
 */
import type { Facts } from './gemini-response'

export type Source = Facts['sources'][number]

/** What the search for one question found. */
export interface Finding {
	readonly question: string
	readonly text: string
}

export function planStep(most: number): string {
	return [
		'# This step',
		`Do not write the report yet. Split the research into 2 to ${most} questions that together cover every section of the format, most important first, and write them in the reader's language.`,
	].join('\n')
}

export function searchStep(question: string): string {
	return [
		'# This step',
		`Research only this question: ${question}`,
		'Search, open the pages you need, and write down the facts as short plain-text notes, at most 300 words. Do not write the report, and do not answer in JSON.',
	].join('\n')
}

export interface ReportParts {
	/** The call's prompt, from `buildPrompt`. */
	readonly prompt: string
	readonly findings: readonly Finding[]
	readonly sources: readonly Source[]
	/** The questions that got no answer before the time limit. */
	readonly unanswered: readonly string[]
}

/** The prompt of the last request: every finding, the pages to cite and what was not researched. */
export function reportPrompt({ prompt, findings, sources, unanswered }: ReportParts): string {
	const researched = findings.map(
		({ question, text }, index) => `## Question ${index + 1}: ${question}\n${text}`,
	)

	const pages = sources.map(({ title, uri }, index) => `${index + 1}. ${title}: ${uri}`)
	const missing = unanswered.map((question) => `- ${question}`)

	const notResearched =
		missing.length === 0
			? []
			: [
					`# Not researched\nThese questions got no answer before the time limit. Name them under the open questions.\n${missing.join('\n')}`,
				]

	return [
		prompt,
		'# Research',
		'What the searches found, question by question. Write the report from it.',
		researched.join('\n\n'),
		`Sources: take sources only from this list.\n${pages.length === 0 ? '- none' : pages.join('\n')}`,
		...notResearched,
	].join('\n\n')
}
