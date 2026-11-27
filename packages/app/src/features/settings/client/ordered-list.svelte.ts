// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { moveItem } from './reorder'

export interface OrderedListOptions<T> {
	readonly initial: readonly T[]
	/** Saves the whole order; `false` when the server did not take it. */
	readonly save: (items: readonly T[]) => Promise<boolean>
}

/**
 * A list the owner reorders by drag or keys: moves show at once, `commit` saves the order when the
 * drag or key ends, and a refused save puts back the last saved order. Shared by the categories and
 * the engines' fallback order.
 */
export class OrderedList<T> {
	public items: readonly T[]

	#saved: readonly T[]

	readonly #save: OrderedListOptions<T>['save']

	public constructor({ initial, save }: OrderedListOptions<T>) {
		this.items = $state.raw(initial)
		this.#saved = initial
		this.#save = save
	}

	public move(from: number, to: number): void {
		this.items = moveItem(this.items, from, to)
	}

	/** Saves the order on screen when it changed; `false` when it had to be put back. */
	public async commit(): Promise<boolean> {
		const order = this.items

		if (
			order.length === this.#saved.length &&
			order.every((item, index) => item === this.#saved[index])
		) {
			return true
		}

		const saved = await this.#save(order)

		if (saved) {
			this.#saved = order
		} else if (this.items === order) {
			this.items = this.#saved
		}

		return saved
	}
}
