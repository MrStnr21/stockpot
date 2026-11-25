// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import type { CaptureCategory, JsonFetch } from '../shared/types'
import { createCaptureApi, type CaptureApi, type SubmitResult } from './capture-api'
import {
	actionsFor,
	canSubmit,
	categoryRow,
	deeperNoteId,
	dismissSeen,
	dismissSenses,
	followAnswer,
	historyMatch,
	initialSelection,
	panelFor,
	pickCategory,
	pickSense,
	usableAnswer,
	type CategoryRow,
	type Selection,
	type SubmitMode,
} from './capture-model'
import {
	followUpFailedToast,
	removedToastMs,
	researchingToast,
	savedToast,
	toastMs,
	ToastQueue,
	undoneToast,
	type CaptureStrings,
} from './capture-toasts.svelte'
import { contextFieldMaxLength } from './split-context'
import { createSuggestionRunner, type SuggestionRunner, type SuggestionState } from './suggestions'

/** The longest note text `POST /api/notes` takes. */
export const maxTermLength = 1000

/** The sheet's error row: the server out of reach, or what it said was wrong with the note. */
export type CaptureError =
	{ readonly kind: 'network' } | { readonly kind: 'invalid'; readonly message: string | null }

export interface CaptureControllerOptions {
	readonly categories: readonly CaptureCategory[]
	readonly strings: CaptureStrings
	readonly fetch: JsonFetch
	readonly signIn: () => void
}

/** The capture sheet's state: the fields, the suggestion, the pick, the save and the toast. */
export class CaptureController {
	readonly #allIds: readonly number[]

	readonly #strings: CaptureStrings

	readonly #signIn: () => void

	readonly #runner: SuggestionRunner

	readonly #api: CaptureApi

	public open = $state(false)

	public term = $state('')

	public contextField = $state('')

	public isPrivate = $state(false)

	public showAll = $state(false)

	public isSaving = $state(false)

	public suggestion = $state.raw<SuggestionState>({ kind: 'empty' })

	public selection = $state.raw<Selection>(initialSelection)

	public error = $state.raw<CaptureError | null>(null)

	public readonly toasts = new ToastQueue()

	public readonly answer = $derived(
		this.suggestion.kind === 'ready' ? this.suggestion.answer : null,
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

	public constructor({ categories, strings, fetch, signIn }: CaptureControllerOptions) {
		this.#allIds = categories.map(({ id }) => id)
		this.#strings = strings
		this.#signIn = signIn
		this.#api = createCaptureApi({ fetch })
		this.#runner = createSuggestionRunner({
			fetch,
			read: () => ({ text: this.term, contextField: this.contextField, private: this.isPrivate }),
			onChange: (state) => {
				this.#follow(state)
			},
		})
	}

	public setOpen(open: boolean): void {
		this.open = open

		if (!open) {
			this.#runner.stop()
		} else if (this.suggestion.kind === 'loading') {
			/* Closing dropped the request in flight; the draft stays, so ask again for it. */
			this.#runner.askNow()
		}
	}

	/** The term was typed: a new term starts over, then asks after a pause. */
	public termChanged(): void {
		this.#startOver()
		this.#runner.schedule()
	}

	public pasteTerm(text: string): void {
		const term = text.trim().slice(0, maxTermLength)

		if (term !== '') {
			this.term = term
			this.#startOver()
			this.#runner.askNow()
		}
	}

	public pasteLink(text: string): void {
		const link = text.trim()

		if (link !== '') {
			this.contextField = [this.contextField.trim(), link]
				.filter((part) => part !== '')
				.join(' ')
				.slice(0, contextFieldMaxLength)
		}
	}

	/** History depends on Private, so the suggestion is asked again at once. */
	public privateChanged(): void {
		this.#runner.askNow()
	}

	public pickCategory(categoryId: number): void {
		this.selection = pickCategory(this.selection, categoryId)
	}

	public pickSense(index: number): void {
		if (this.answer !== null) {
			this.selection = pickSense(this.selection, this.answer, index)
		}
	}

	public noneOfThese(): void {
		if (this.answer !== null) {
			this.selection = dismissSenses(this.selection, this.answer)
		}
	}

	public differentMeaning(): void {
		if (this.answer !== null) {
			this.selection = dismissSeen(this.selection, this.answer)
		}
	}

	public toggleAll(): void {
		this.showAll = !this.showAll
	}

	/** The primary button or ⌘↩ saves; the tonal one or ⇧⌘↩ researches now, or goes deeper. */
	public async submit(button: 'primary' | 'secondary'): Promise<void> {
		const { categoryId } = this.selection

		if (categoryId === null || this.isSaving) {
			return
		}

		const mode: SubmitMode = button === 'primary' ? 'save' : this.actions.secondary
		const seen = this.answer === null ? null : historyMatch(this.answer, 'seen')
		const term = this.term.trim()

		this.isSaving = true
		this.error = null

		const result = await this.#api.submit({
			mode,
			draft: {
				text: this.term,
				contextField: this.contextField,
				categoryId,
				private: this.isPrivate,
			},
			deeperNoteId: mode === 'deeper' && seen !== null ? deeperNoteId(seen) : null,
		})

		this.isSaving = false
		this.#settle(result, mode, term)
	}

	public async undo(noteId: number): Promise<void> {
		const removed = await this.#api.undo(noteId)

		this.toasts.show(undoneToast(this.#strings, removed), removed ? removedToastMs : toastMs)
	}

	public destroy(): void {
		this.#runner.stop()
		this.toasts.destroy()
	}

	#settle(result: SubmitResult, mode: SubmitMode, term: string) {
		if (result.kind === 'busy') {
			return
		}

		if (result.kind === 'unauthorized') {
			this.#signIn()

			return
		}

		if (result.kind === 'invalid' || result.kind === 'failed') {
			this.error =
				result.kind === 'invalid'
					? { kind: 'invalid', message: result.message }
					: { kind: 'network' }

			return
		}

		this.setOpen(false)
		this.#reset()

		const id = this.toasts.show(
			mode === 'save'
				? savedToast(this.#strings, term, result.canUndo ? result.note.id : null)
				: researchingToast(this.#strings, term),
		)

		result.followUp
			?.then((started) => {
				/* A newer toast means the owner moved on; the failure would only interrupt them. */
				if (!started && this.toasts.isLatest(id)) {
					this.toasts.show(followUpFailedToast(this.#strings, term))
				}
			})
			.catch(() => null)
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

	#startOver() {
		this.selection = initialSelection
		this.showAll = false

		if (this.error?.kind === 'invalid') {
			this.error = null
		}
	}

	#reset() {
		this.term = ''
		this.contextField = ''
		this.isPrivate = false
		this.showAll = false
		this.selection = initialSelection
		this.suggestion = { kind: 'empty' }
		this.error = null
	}
}
