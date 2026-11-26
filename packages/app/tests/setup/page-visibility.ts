// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { drainMicrotasks } from 'bun:jsc'

import type { PageVisibility } from '#/features/research/client/poll'

/** A page whose visibility the spec switches. */
export class FakeVisibility implements PageVisibility {
	public isHidden = false

	readonly #listeners = new Set<() => void>()

	public readonly hidden = (): boolean => this.isHidden

	public readonly watch = (listener: () => void): (() => void) => {
		this.#listeners.add(listener)

		return () => {
			this.#listeners.delete(listener)
		}
	}

	public set(hidden: boolean): void {
		this.isHidden = hidden

		for (const listener of this.#listeners) {
			listener()
		}

		drainMicrotasks()
	}
}
