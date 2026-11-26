// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import {
	createCaptureApi,
	type CaptureApi,
	type CaptureDraft,
	type SubmitResult,
} from './capture-api'
import {
	CaptureDraftState,
	type CaptureDraftOptions,
	type CaptureError,
} from './capture-draft.svelte'
import { deeperNoteId, historyMatch, type SubmitMode } from './capture-model'
import {
	followUpFailedToast,
	removedToastMs,
	researchingToast,
	savedToast,
	saveFailedToast,
	toastMs,
	ToastQueue,
	undoneToast,
	type CaptureStrings,
} from './capture-toasts.svelte'

export { maxTermLength, type CaptureError } from './capture-draft.svelte'

export interface CaptureControllerOptions extends CaptureDraftOptions {
	readonly strings: CaptureStrings
	readonly signIn: () => void
}

/** The capture sheet's state: the draft, its save and the toast that follows. */
export class CaptureController extends CaptureDraftState {
	readonly #strings: CaptureStrings
	readonly #signIn: () => void
	readonly #api: CaptureApi

	public readonly toasts = new ToastQueue()

	public constructor({ strings, signIn, ...options }: CaptureControllerOptions) {
		super(options)
		this.#strings = strings
		this.#signIn = signIn
		this.#api = createCaptureApi({ fetch: options.fetch })
	}

	/** The primary button or ⌘↩ saves; the tonal one or ⇧⌘↩ researches now, or goes deeper. */
	public async submit(button: 'primary' | 'secondary'): Promise<void> {
		const { categoryId } = this.selection

		if (categoryId === null || this.isSaving) {
			return
		}

		const mode: SubmitMode = button === 'primary' ? 'save' : this.actions.secondary
		const seen = this.answer === null ? null : historyMatch(this.answer, 'seen')

		const draft = this.send(categoryId)

		this.isSaving = true
		this.error = null

		const result = await this.#api.submit({
			mode,
			draft,
			deeperNoteId: mode === 'deeper' && seen !== null ? deeperNoteId(seen) : null,
		})

		this.isSaving = false
		this.#settle(result, mode, draft)
	}

	public async undo(noteId: number): Promise<void> {
		const result = await this.#api.undo(noteId)

		if (result !== 'busy') {
			const removed = result === 'removed'

			this.toasts.show(undoneToast(this.#strings, removed), removed ? removedToastMs : toastMs)
		}
	}

	public override destroy(): void {
		super.destroy()
		this.toasts.destroy()
	}

	/*
	 * The sheet may hold a new draft by the time a save answers, after Esc and N; only the draft that
	 * was sent is closed and cleared. A failure shows once: in the error row of the open sheet that
	 * still holds the draft, else in a toast, so a draft is never lost in silence. Closed, the sheet
	 * keeps the failed draft for when it opens again.
	 */
	#settle(result: SubmitResult, mode: SubmitMode, draft: CaptureDraft) {
		const term = draft.text.trim()
		const isCurrent = this.holds(draft)

		if (result.kind === 'busy') {
			return
		}

		if (result.kind === 'unauthorized') {
			this.#signIn()

			return
		}

		if (result.kind === 'invalid' || result.kind === 'failed') {
			const error: CaptureError =
				result.kind === 'invalid'
					? { kind: 'invalid', message: result.message }
					: { kind: 'network' }

			if (isCurrent && this.open) {
				this.error = error
			} else {
				this.toasts.show(saveFailedToast(this.#strings, term, error))
			}

			return
		}

		if (isCurrent) {
			this.setOpen(false)
			this.clear()
		}

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
}
