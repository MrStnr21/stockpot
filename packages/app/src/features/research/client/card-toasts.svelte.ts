// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

/** DES-2: a toast stays 4 s. */
export const toastMs = 4000

export interface CardToast {
	readonly id: number
	readonly tone: 'default' | 'error'
	readonly title: string
}

/** One toast at a time: a new one replaces the old, and each goes when its time is up. */
export class CardToasts {
	public current = $state.raw<CardToast | null>(null)

	#timer: ReturnType<typeof setTimeout> | null = null

	#lastId = 0

	public show(title: string, tone: CardToast['tone'] = 'default'): void {
		this.#lastId += 1

		const id = this.#lastId

		this.current = { id, tone, title }
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
