// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

/*
 * The prompt every engine sends (docs/engines.md, "Prompts"): rules, task, format, category, note and
 * earlier cards, in that order. The JSON Schema is not part of it: each engine passes the schema
 * through its provider's structured-output option or, for the agent command, its template.
 */
import type { CardInput, EngineInput, EngineNote, Redacted, SuggestInput } from './contract'

export interface PromptOptions {
	/** Whether the engine can search and open pages. One that cannot may not cite any. */
	readonly canSearch: boolean
}

const languageNames = new Intl.DisplayNames(['en'], { type: 'language' })

function languageName(code: string) {
	const name = languageNames.of(code)

	return name === undefined || name === code ? code : `${name} (${code})`
}

function rules(language: string, { canSearch }: PromptOptions) {
	const links = canSearch
		? 'Link only to pages you opened or saw in search results during this task, never to an address from memory or one you built, and only to http or https addresses.'
		: 'You cannot search or open pages, so leave every list of sources empty.'

	return [
		'# Rules',
		`- Write for the reader in ${languageName(language)}.`,
		'- Be concise and concrete.',
		'- Where the format lets you say you are unsure, say so rather than guess.',
		`- ${links}`,
		'- Answer only with JSON that matches the schema you were given.',
	].join('\n')
}

function suggestTask({ categories }: SuggestInput) {
	const lines = categories.map(({ id, name, hint }) =>
		hint === null ? `- ${id}: ${name}` : `- ${id}: ${name}, ${hint}`,
	)

	return ['# Task', 'Suggest categories for the note. The categories:', ...lines].join('\n')
}

function cardTask({ task, depth }: CardInput, { canSearch }: PromptOptions) {
	const what =
		task === 'explain'
			? `Write a level ${depth} card about the note.`
			: `Write a level ${depth} report on the note, an idea the reader might build${canSearch ? ', searching widely' : ''}.`

	return `# Task\n${what}`
}

function category({ category: { name, instructions } }: CardInput) {
	return instructions === null ? `# Category\n${name}` : `# Category\n${name}\n\n${instructions}`
}

function note({ term, text, context, url }: EngineNote) {
	const lines = [
		`Term: ${term}`,
		text === null ? null : `As typed: ${text}`,
		context === null ? null : `Where the reader saw it: ${context}`,
		url === null ? null : `Link: ${url}`,
	]

	return ['# Note', ...lines.filter((line) => line !== null)].join('\n')
}

function earlierCards({ previous }: CardInput) {
	return previous.length === 0
		? null
		: `# Earlier cards\nThe note's cards at the lower levels. Build on them and do not repeat them.\n\n${JSON.stringify(previous)}`
}

/** The prompt for a call. A private note was redacted to its term, so only the term appears. */
export function buildPrompt(input: Redacted<EngineInput>, options: PromptOptions): string {
	const format = `# Format\n${input.output.instructions}`

	const sections =
		input.task === 'suggest'
			? [rules(input.language, options), suggestTask(input), format, note(input.note)]
			: [
					rules(input.language, options),
					cardTask(input, options),
					format,
					category(input),
					note(input.note),
					earlierCards(input),
				]

	return sections.filter((section) => section !== null).join('\n\n')
}
