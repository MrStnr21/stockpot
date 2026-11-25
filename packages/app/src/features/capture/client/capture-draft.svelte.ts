// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import type { CaptureCategory, JsonFetch } from '../shared/types'
import type { CaptureDraft } from './capture-api'
import {
	actionsFor,
	canSubmit,
	categoryRow,
	dismissSeen,
	dismissSenses,
	followAnswer,
	initialSelection,
	panelFor,
	pickCategory,
	pickSense,
	usableAnswer,
	type CategoryRow,
	type Selection,
} from './capture-model'
import { contextFieldMaxLength, cutText } from './split-context'
import { createSuggestionRunner, type SuggestionRunner, type SuggestionState } from './suggestions'

/** The longest note text `POST /api/notes` takes. */
export const maxTermLength = 1000

/** The sheet's error row: the server out of reach, or what it said was wrong with the note. */
export type CaptureError =
	{ readonly kind: 'network' } | { readonly kind: 'invalid'; readonly message: string | null }

/** A draft as a save sent it, with the count of the owner's category choices at that moment. */
export interface SentDraft {
	readonly draft: CaptureDraft
	readonly picks: number
}

export interface CaptureDraftOptions {
	readonly categories: readonly CaptureCategory[]
	readonly fetch: JsonFetch
	readonly isOnline?: () => boolean
}

/** The draft in the sheet: its fields, the suggestion for its term and the pick. */
export class CaptureDraftState {
	readonly #allIds: readonly number[]
	readonly #runner: SuggestionRunner

	/** The trimmed term the suggestion follows, so an edit that keeps it keeps the pick too. */
	#askedTerm = ''

	/*
	 * The owner's own choices of category: a chip, a meaning, "None of these", "Different meaning" or
	 * a new term. The term, the context and Private change only when the owner edits them, but the
	 * category also follows each answer, so a changed category counts as an edit only after these.
	 */
	#picks = 0

	public open = $state(false)
	public term = $state('')
	public contextField = $state('')
	public isPrivate = $state(false)
	public showAll = $state(false)
	public isSaving = $state(false)
	public suggestion = $state.raw<SuggestionState>({ kind: 'empty' })
	public selection = $state.raw<Selection>(initialSelection)
	public error = $state.raw<CaptureError | null>(null)

	/** The answer for the term as it stands; one for an earlier term never shows. */
	public readonly answer = $derived(
		this.suggestion.kind === 'ready' && this.suggestion.text === this.term.trim()
			? this.suggestion.answer
			: null,
	)

	public readonly panel = $derived(panelFor(this.answer, this.selection))

	public readonly actions = $derived(actionsFor(this.panel))

	public readonly canSubmit = $derived(canSubmit(this.selection, this.isSaving))

	public get row(): CategoryRow {
		return categoryRow({
			state: this.suggestion,
			allIds: this.#allIds,
			selection: this.selection,
			showAll: this.showAll,
		})
	}

	public constructor({ categories, fetch, isOnline }: CaptureDraftOptions) {
		this.#allIds = categories.map(({ id }) => id)
		this.#runner = createSuggestionRunner({
			fetch,
			read: () => ({ text: this.term, contextField: this.contextField, private: this.isPrivate }),
			onChange: (state) => {
				this.#follow(state)
			},
			isOnline,
		})
	}

	public setOpen(open: boolean): void {
		this.open = open

		if (!open) {
			this.#runner.stop()
		} else if (this.answer === null && this.term.trim() !== '') {
			/* Closing dropped the request or the pause; the draft stays, so ask again for it. */
			this.#runner.askNow()
		}
	}

	/** The term was typed: a new term starts over, then asks after a pause. */
	public termChanged(): void {
		if (this.#startOver()) {
			this.#runner.schedule()
		}
	}

	public pasteTerm(text: string): void {
		const term = cutText(text.trim(), maxTermLength)

		if (term !== '') {
			this.term = term
			this.#startOver()
			this.#runner.askNow()
		}
	}

	public pasteLink(text: string): void {
		const link = text.trim()

		if (link !== '') {
			this.contextField = cutText(
				[this.contextField.trim(), link].filter((part) => part !== '').join(' '),
				contextFieldMaxLength,
			)
		}
	}

	/** History depends on Private, so the suggestion is asked again at once. */
	public privateChanged(): void {
		this.#runner.askNow()
	}

	public pickCategory(categoryId: number): void {
		this.#picks += 1
		this.selection = pickCategory(this.selection, categoryId)
	}

	public pickSense(index: number): void {
		if (this.answer !== null) {
			this.#picks += 1
			this.selection = pickSense(this.selection, this.answer, index)
		}
	}

	public noneOfThese(): void {
		if (this.answer !== null) {
			this.#picks += 1
			this.selection = dismissSenses(this.selection, this.answer)
		}
	}

	public differentMeaning(): void {
		if (this.answer !== null) {
			this.#picks += 1
			this.selection = dismissSeen(this.selection, this.answer)
		}
	}

	public toggleAll(): void {
		this.showAll = !this.showAll
	}

	public destroy(): void {
		this.#runner.stop()
	}

	/** The draft as it stands, to send with this category. */
	protected send(categoryId: number): SentDraft {
		return {
			draft: {
				text: this.term,
				contextField: this.contextField,
				categoryId,
				private: this.isPrivate,
			},
			picks: this.#picks,
		}
	}

	/**
	 * The sheet still holds this draft: the owner changed none of its fields since it was sent. A
	 * category that only followed a later answer leaves the draft the same.
	 */
	protected holds({ draft, picks }: SentDraft): boolean {
		return (
			draft.text === this.term &&
			draft.contextField === this.contextField &&
			draft.private === this.isPrivate &&
			(picks === this.#picks || draft.categoryId === this.selection.categoryId)
		)
	}

	protected clear(): void {
		this.#askedTerm = ''
		this.term = ''
		this.contextField = ''
		this.isPrivate = false
		this.showAll = false
		this.selection = initialSelection
		this.suggestion = { kind: 'empty' }
		this.error = null
	}

	#follow(state: SuggestionState) {
		if (state.kind !== 'ready') {
			this.suggestion = state

			return
		}

		const answer = usableAnswer(state.answer, this.#allIds)

		this.suggestion = { ...state, answer }
		this.selection = followAnswer(this.selection, answer)
	}

	/** A new term starts over: no pick, the row folded. False when the trimmed term is the same. */
	#startOver() {
		const term = this.term.trim()

		if (term === this.#askedTerm) {
			return false
		}

		this.#askedTerm = term
		this.#picks += 1
		this.selection = initialSelection
		this.showAll = false

		if (this.error?.kind === 'invalid') {
			this.error = null
		}

		return true
	}
}
