// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

/* The notes list's toast pattern (`features/notes/client/notes-toasts.svelte.ts`), copied: features do
 * not import each other. */

/** DES-2: a toast stays 4 s. */
export const toastMs = 4000

export interface SettingsToast {
	readonly id: number
	readonly tone: 'default' | 'error'
	readonly title: string
}

export type ToastContent = Omit<SettingsToast, 'id'>

export function errorToast(title: string): ToastContent {
	return { tone: 'error', title }
}

/** One toast at a time: a new one replaces the old, and each goes when its time is up. */
export class SettingsToasts {
	public current = $state.raw<SettingsToast | null>(null)

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
