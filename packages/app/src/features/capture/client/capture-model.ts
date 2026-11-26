// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

/*
 * Pure derivations for the capture sheet: which panel shows, which category is picked, what the
 * category row lists and what the two buttons do. The sheet keeps a `Selection` in its state and
 * passes it through these functions; none of them reads anything else.
 */
import type { SuggestAnswer, SuggestHistoryMatch } from '../shared/types'
import type { SuggestionState } from './suggestions'

export type Panel = 'saved' | 'senses' | 'seen'

export interface Selection {
	readonly categoryId: number | null
	/** The picked meaning, while the sense choice shows. */
	readonly senseIndex: number | null
	/** The owner tapped a chip or a meaning; a later answer keeps that pick. */
	readonly isUserPick: boolean
	/** "None of these" was chosen. */
	readonly sensesDismissed: boolean
	/** "Different meaning" was chosen. */
	readonly seenDismissed: boolean
}

/** The selection for a new term: nothing picked or dismissed. */
export const initialSelection: Selection = {
	categoryId: null,
	senseIndex: null,
	isUserPick: false,
	sensesDismissed: false,
	seenDismissed: false,
}

const maxSuggestedCategories = 3

/** Keeps only categories the sheet knows, so a pick always names a chip it can draw. */
export function usableAnswer(answer: SuggestAnswer, knownIds: readonly number[]): SuggestAnswer {
	const known = new Set(knownIds)
	const senses = answer.senses.filter(({ categoryId }) => known.has(categoryId))

	return {
		...answer,
		categories: [...new Set(answer.categories)]
			.filter((id) => known.has(id))
			.slice(0, maxSuggestedCategories),
		senses: senses.length >= 2 ? senses : [],
		history: answer.history.map((match) =>
			match.categoryId === null || known.has(match.categoryId)
				? match
				: { ...match, categoryId: null },
		),
	}
}

export function historyMatch(
	answer: SuggestAnswer,
	state: 'saved' | 'seen',
): SuggestHistoryMatch | null {
	return answer.history.find((match) => match.state === state) ?? null
}

/*
 * A history panel has no chips, so it shows only when it brings a category to save with: the
 * match's own, or else a suggested one. A term without a category falls back to the chips.
 */
function pickableMatch(answer: SuggestAnswer, state: 'saved' | 'seen') {
	const match = historyMatch(answer, state)

	return match !== null && (match.categoryId !== null || answer.categories.length > 0)
}

/**
 * A saved note the capture would merge into comes first, then a choice of meanings, then a term
 * shown before. "None of these" leaves the plain chips, so it hides the seen panel too.
 */
export function panelFor(answer: SuggestAnswer | null, selection: Selection): Panel | null {
	if (answer === null) {
		return null
	}

	if (pickableMatch(answer, 'saved')) {
		return 'saved'
	}

	if (answer.senses.length >= 2) {
		return selection.sensesDismissed ? null : 'senses'
	}

	if (pickableMatch(answer, 'seen') && !selection.seenDismissed) {
		return 'seen'
	}

	return null
}

function suggestedCategory(answer: SuggestAnswer, selection: Selection) {
	const panel = panelFor(answer, selection)

	if (panel === 'senses') {
		return answer.senses.at(selection.senseIndex ?? 0)?.categoryId ?? null
	}

	const match = panel === null ? null : historyMatch(answer, panel)

	return match?.categoryId ?? answer.categories.at(0) ?? null
}

/** Picks what the answer suggests, unless the owner has picked already. */
export function followAnswer(selection: Selection, answer: SuggestAnswer): Selection {
	if (selection.isUserPick) {
		return selection
	}

	const senseIndex = panelFor(answer, selection) === 'senses' ? 0 : null
	const next = { ...selection, senseIndex }

	return { ...next, categoryId: suggestedCategory(answer, next) }
}

export function pickCategory(selection: Selection, categoryId: number): Selection {
	return { ...selection, categoryId, isUserPick: true }
}

export function pickSense(selection: Selection, answer: SuggestAnswer, index: number): Selection {
	const sense = answer.senses.find((_, at) => at === index)

	return sense === undefined
		? selection
		: { ...selection, senseIndex: index, categoryId: sense.categoryId, isUserPick: true }
}

/** "None of these": the chips come back with the first suggestion picked. */
export function dismissSenses(selection: Selection, answer: SuggestAnswer): Selection {
	const next = { ...selection, sensesDismissed: true, senseIndex: null, isUserPick: false }

	return { ...next, categoryId: suggestedCategory(answer, next) }
}

/** "Different meaning": the chips come back with the suggestion, and the buttons with them. */
export function dismissSeen(selection: Selection, answer: SuggestAnswer): Selection {
	const next = { ...selection, seenDismissed: true }

	return next.isUserPick ? next : { ...next, categoryId: suggestedCategory(answer, next) }
}

export type SubmitMode = 'save' | 'research' | 'deeper'

export interface Actions {
	/** The tonal button, also ⇧⌘↩. */
	readonly secondary: 'research' | 'deeper'
	/** The primary button, also ⌘↩: each label saves the note. */
	readonly primary: 'save' | 'addContext' | 'repeat'
}

export function actionsFor(panel: Panel | null): Actions {
	if (panel === 'saved') {
		return { secondary: 'research', primary: 'addContext' }
	}

	if (panel === 'seen') {
		return { secondary: 'deeper', primary: 'repeat' }
	}

	return { secondary: 'research', primary: 'save' }
}

export function canSubmit(selection: Selection, isSaving: boolean): boolean {
	return selection.categoryId !== null && !isSaving
}

export interface CategoryRow {
	/** `hint` before a term, `plain` when nothing was suggested. */
	readonly label: 'hint' | 'suggesting' | 'suggested' | 'all' | 'plain'
	readonly ids: readonly number[]
}

export interface CategoryRowInput {
	readonly state: SuggestionState
	readonly allIds: readonly number[]
	readonly selection: Selection
	/** "All categories" was chosen. */
	readonly showAll: boolean
}

/** The chips under the term; a pick made from every category stays in view when the row folds. */
export function categoryRow({ state, allIds, selection, showAll }: CategoryRowInput): CategoryRow {
	if (state.kind === 'empty') {
		return { label: 'hint', ids: [] }
	}

	if (state.kind === 'loading') {
		return { label: 'suggesting', ids: [] }
	}

	const suggested = state.answer.categories

	if (suggested.length === 0) {
		return { label: 'plain', ids: allIds }
	}

	if (showAll) {
		return { label: 'all', ids: allIds }
	}

	const picked = selection.categoryId

	return {
		label: 'suggested',
		ids: picked === null || suggested.includes(picked) ? suggested : [...suggested, picked],
	}
}

/** The seen panel's line: the meaning the last card was written for, else the term's own. */
export function seenLine(match: SuggestHistoryMatch): string | null {
	const sense = match.lastCard?.sense?.trim() ?? ''

	if (sense !== '') {
		return sense
	}

	const meaning = match.meaning.trim()

	return meaning === '' ? null : meaning
}

/** The note "Deeper now" asks for: the one the last card belongs to. */
export function deeperNoteId(match: SuggestHistoryMatch): number | null {
	return match.lastCard?.noteId ?? match.note?.id ?? null
}
