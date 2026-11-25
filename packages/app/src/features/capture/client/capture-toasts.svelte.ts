// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import type { Messages } from '#/lib/i18n/en'

export type CaptureStrings = Messages['capture']

/** DES-2: a toast stays 4 s. */
export const toastMs = 4000

/** "Removed" only confirms the Undo, so it goes sooner. */
export const removedToastMs = 2000

export type ToastAction =
	{ readonly kind: 'undo'; readonly noteId: number } | { readonly kind: 'view' }

export interface CaptureToast {
	readonly id: number
	readonly tone: 'default' | 'loading' | 'error'
	readonly title: string
	readonly detail: string | null
	readonly action: ToastAction | null
}

export type ToastContent = Omit<CaptureToast, 'id'>

export function withTerm(template: string, term: string): string {
	return template.replace('{term}', term)
}

/** After a save: Undo only for a new note, since a merged one would take the saved note with it. */
export function savedToast(
	strings: CaptureStrings,
	term: string,
	newNoteId: number | null,
): ToastContent {
	return {
		tone: 'default',
		title: withTerm(strings.savedToast, term),
		detail: newNoteId === null ? strings.mergedDetail : strings.savedDetail,
		action: newNoteId === null ? null : { kind: 'undo', noteId: newNoteId },
	}
}

export function researchingToast(strings: CaptureStrings, term: string): ToastContent {
	return {
		tone: 'loading',
		title: withTerm(strings.researchingToast, term),
		detail: strings.researchingDetail,
		action: { kind: 'view' },
	}
}

/** One toast at a time: a new one replaces the old, and each goes when its time is up. */
export class ToastQueue {
	public current = $state.raw<CaptureToast | null>(null)

	#timer: ReturnType<typeof setTimeout> | null = null

	#lastId = 0

	public show(content: ToastContent, ms = toastMs): number {
		this.#lastId += 1

		const id = this.#lastId

		this.current = { ...content, id }
		this.#clearTimer()
		this.#timer = setTimeout(() => {
			if (this.current?.id === id) {
				this.current = null
			}
		}, ms)

		return id
	}

	/** No newer toast has replaced this one. */
	public isLatest(id: number): boolean {
		return this.#lastId === id
	}

	public destroy(): void {
		this.#clearTimer()
	}

	#clearTimer() {
		if (this.#timer !== null) {
			clearTimeout(this.#timer)
			this.#timer = null
		}
	}
}
