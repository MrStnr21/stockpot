// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

/*
 * What the opened card does once an action's answer is in (WEB-5 decision 3), and the card's
 * requests for its own view. The pane may have moved on to another note while the action ran: then
 * the card on screen stays as it is, but a list on the page still hears that its notes changed.
 */
import type { CardView } from '../shared/card-view'
import type { ActionOutcome } from './card-actions'
import type { CardApi, CardResult } from './card-api'
import type { Depth } from './card-panel'
import type { CardStrings } from './card-text'

/** The card's state after an action that took it off the screen. */
export type GoneState =
	| { readonly kind: 'deleted'; readonly view: CardView; readonly canUndo: boolean }
	| { readonly kind: 'missing' }

export interface Settlement {
	/** The state the card takes instead of a fetched card. */
	readonly state: GoneState | null
	/** The level to show after the card is fetched again. */
	readonly depth: Depth | null
	readonly toast: { readonly title: string; readonly tone: 'default' | 'error' } | null
	/** A list on the page loads again. */
	readonly notesChanged: boolean
	readonly signIn: boolean
}

const nothing: Settlement = {
	state: null,
	depth: null,
	toast: null,
	notesChanged: false,
	signIn: false,
}

/** Whether the card is fetched again before the rest of the settlement, while it is on screen. */
export function refetches(outcome: ActionOutcome): boolean {
	return outcome.kind === 'done' || outcome.kind === 'conflict'
}

/**
 * The rest of an action's settlement. `onScreen` says whether the pane still shows the note the
 * action was for; a deleted note that is no longer on screen gets a toast, since its panel (and its
 * Undo) would replace another note's card.
 */
export function settlement(
	view: CardView,
	outcome: ActionOutcome,
	{ onScreen, strings }: { onScreen: boolean; strings: CardStrings },
): Settlement {
	switch (outcome.kind) {
		case 'done': {
			return onScreen
				? {
						...nothing,
						depth: outcome.depth,
						toast: outcome.toast === null ? null : { title: outcome.toast, tone: 'default' },
						notesChanged: true,
					}
				: { ...nothing, notesChanged: true }
		}

		case 'conflict': {
			return onScreen
				? { ...nothing, toast: { title: strings.conflictToast, tone: 'default' } }
				: nothing
		}

		case 'deleted': {
			return onScreen
				? {
						...nothing,
						state: { kind: 'deleted', view, canUndo: outcome.canUndo },
						notesChanged: true,
					}
				: {
						...nothing,
						toast: { title: strings.deletedToast, tone: 'default' },
						notesChanged: true,
					}
		}

		case 'missing': {
			return { ...nothing, state: onScreen ? { kind: 'missing' } : null, notesChanged: true }
		}

		case 'signIn': {
			return { ...nothing, signIn: true }
		}

		case 'error': {
			return { ...nothing, toast: { title: outcome.toast, tone: 'error' } }
		}

		default: {
			throw new Error('An action ended in a way the card does not know.')
		}
	}
}

/** The card's requests for its view, one at a time: a newer one, or a cancel, drops the older answer. */
export class CardLoads {
	readonly #api: CardApi

	#sequence = 0
	#request: AbortController | null = null

	public constructor(api: CardApi) {
		this.#api = api
	}

	/** The card of `id`, or `null` when a newer request or a cancel replaced this one, or `id` left the screen. */
	public async load(id: number, isShown: () => boolean): Promise<CardResult<CardView> | null> {
		this.cancel()

		const sequence = this.#sequence
		const request = new AbortController()

		this.#request = request

		const result = await this.#api.card(id, request.signal)

		if (sequence !== this.#sequence || !isShown()) {
			return null
		}

		this.#request = null

		return result
	}

	/** Aborts the request on its way, so its answer never lands. */
	public cancel(): void {
		this.#sequence += 1
		this.#request?.abort()
		this.#request = null
	}
}
