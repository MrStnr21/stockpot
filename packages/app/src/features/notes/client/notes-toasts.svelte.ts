// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import type { BulkSummary } from './bulk'

/** The texts the list's logic writes itself: day groups and toasts. `{count}` and `{category}` are filled in. */
export interface NotesStrings {
	readonly today: string
	readonly yesterday: string
	readonly thisWeek: string
	readonly researchingToastOne: string
	readonly researchingToastOther: string
	readonly movedToastOne: string
	readonly movedToastOther: string
	readonly archivedToastOne: string
	readonly archivedToastOther: string
	readonly notArchivedOne: string
	readonly notArchivedOther: string
	readonly deletedElsewhereOne: string
	readonly deletedElsewhereOther: string
	readonly selectLimitToast: string
	readonly bulkFailedToast: string
	readonly loadFailedToast: string
}

/** DES-2: a toast stays 4 s. */
export const toastMs = 4000

export interface NotesToast {
	readonly id: number
	readonly tone: 'default' | 'error'
	readonly title: string
	/** Further sentences, such as the notes an action could not reach. */
	readonly detail: string | null
}

export type ToastContent = Omit<NotesToast, 'id'>

/** A counted text: the `…One` key for one, the `…Other` key otherwise. */
export function counted(one: string, other: string, count: number): string {
	return (count === 1 ? one : other).replaceAll('{count}', String(count))
}

export function errorToast(title: string): ToastContent {
	return { tone: 'error', title, detail: null }
}

/** What a bulk answer did, with the notes it could not reach after it. */
export function bulkToast(
	strings: NotesStrings,
	summary: BulkSummary,
	categoryName: string,
): ToastContent {
	const { action, done, conflicts, deleted } = summary
	let title = counted(strings.archivedToastOne, strings.archivedToastOther, done)

	if (action.kind === 'research') {
		title = counted(strings.researchingToastOne, strings.researchingToastOther, done)
	} else if (action.kind === 'move') {
		title = counted(strings.movedToastOne, strings.movedToastOther, done).replaceAll(
			'{category}',
			categoryName,
		)
	}

	const details = [
		conflicts > 0 ? counted(strings.notArchivedOne, strings.notArchivedOther, conflicts) : null,
		deleted > 0
			? counted(strings.deletedElsewhereOne, strings.deletedElsewhereOther, deleted)
			: null,
	].filter((detail) => detail !== null)

	return { tone: 'default', title, detail: details.length === 0 ? null : details.join(' ') }
}

/** One toast at a time: a new one replaces the old, and each goes when its time is up. */
export class NotesToasts {
	public current = $state.raw<NotesToast | null>(null)

	#timer: ReturnType<typeof setTimeout> | null = null

	#lastId = 0

	public show(content: ToastContent): void {
		this.#lastId += 1

		const id = this.#lastId

		this.current = { ...content, id }
		this.destroy()
		this.#timer = setTimeout(() => {
			if (this.current?.id === id) {
				this.current = null
			}
		}, toastMs)
	}

	/** Drops the timer of the toast on screen. */
	public destroy(): void {
		if (this.#timer !== null) {
			clearTimeout(this.#timer)
			this.#timer = null
		}
	}
}
