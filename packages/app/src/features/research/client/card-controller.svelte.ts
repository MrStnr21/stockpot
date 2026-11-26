// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

/*
 * The opened card's state, on its own page and in the pane beside the list: the card on screen, the
 * level picked, one action at a time, polling while research runs, and the toasts. Every request for
 * the card goes through one sequence, so only the newest answer for the note on screen ever lands.
 */
import { notesChangedEvent } from '#/lib/events'

import type { CardView } from '../shared/card-view'
import { sendAction, type ActionKind, type ActionOutcome, type CardAction } from './card-actions'
import { createCardApi, type CardApi, type CardResult, type JsonFetch } from './card-api'
import { cardLayout, type CardLayout, type Depth, type NotionState } from './card-panel'
import type { CardStrings } from './card-text'
import { CardToasts } from './card-toasts.svelte'
import { cardPoller, type CardPollerOptions, type Poller } from './poll'

export type CardState =
	/** The pane before a note is picked. */
	| { readonly kind: 'empty' }
	| { readonly kind: 'card'; readonly view: CardView }
	/** Deleted from this card or elsewhere; Undo only brings back what this card deleted. */
	| { readonly kind: 'deleted'; readonly view: CardView; readonly canUndo: boolean }
	/** There is no such note, or it was deleted before the card could show it. */
	| { readonly kind: 'missing' }

export interface CardControllerOptions extends CardPollerOptions {
	/** The card the server rendered, or `null` for an empty pane. */
	readonly initial: CardView | null
	readonly strings: CardStrings
	readonly fetch: JsonFetch
	readonly notion?: NotionState
	readonly signIn?: () => void
	/** Tells the page its notes changed; by default it sends `notesChangedEvent`. */
	readonly notesChanged?: () => void
}

function signInPage() {
	globalThis.location.assign('/signin')
}

function announceNotesChanged() {
	globalThis.dispatchEvent(new Event(notesChangedEvent))
}

const unsettled = new Set(['queued', 'researching'])

export class CardController {
	public state = $state.raw<CardState>({ kind: 'empty' })

	/** The level the owner picked on the depth switch. */
	public picked = $state.raw<Depth>(1)

	/** The action on its way: every action button waits for it. */
	public running = $state.raw<ActionKind | null>(null)

	/** Another note's card is on its way: the card on screen stays, marked busy. */
	public loading = $state.raw(false)

	public readonly toasts = new CardToasts()

	declare public readonly layout: CardLayout | null

	/** Whether the action buttons take a press. */
	declare public readonly canAct: boolean

	readonly #api: CardApi
	readonly #strings: CardStrings
	readonly #signIn: () => void
	readonly #notesChanged: () => void
	readonly #poller: Poller

	#noteId: number | null
	#sequence = 0
	#request: AbortController | null = null

	public constructor(options: CardControllerOptions) {
		const notion = options.notion ?? 'off'

		this.#api = createCardApi({ fetch: options.fetch })
		this.#strings = options.strings
		this.#signIn = options.signIn ?? signInPage
		this.#notesChanged = options.notesChanged ?? announceNotesChanged
		this.#noteId = options.initial?.note.id ?? null

		if (options.initial !== null) {
			this.state = { kind: 'card', view: options.initial }
		}

		this.layout = $derived(
			this.state.kind === 'card' ? cardLayout(this.state.view, this.picked, notion) : null,
		)
		this.canAct = $derived(this.running === null && !this.loading)
		this.#poller = cardPoller(
			() => (this.state.kind === 'card' ? this.state.view : null),
			async () => this.refresh(),
			options,
		)
		this.#poller.update()
	}

	public pick(depth: Depth): void {
		this.picked = depth
	}

	/** The pane shows another note's card; picking the note on screen again does nothing. */
	public async open(id: number): Promise<void> {
		if (id === this.#noteId && this.state.kind !== 'empty') {
			return
		}

		this.#noteId = id
		this.picked = 1
		this.loading = true

		const result = await this.#load(id)

		if (result !== null) {
			this.loading = false
			this.#show(result, { quiet: false })
		}
	}

	/** Polling: the card on screen again, quietly. An action's own fetch takes precedence. */
	public async refresh(): Promise<void> {
		const id = this.#noteId

		if (id === null || this.running !== null || this.loading) {
			return
		}

		const result = await this.#load(id)

		if (result !== null) {
			this.#show(result, { quiet: true })
		}
	}

	/**
	 * Every action button calls this. One action at a time, set before the request leaves, so a
	 * double tap sends once; the card changes only from the server's answer.
	 */
	public async run(action: CardAction): Promise<void> {
		const view = this.#actionView(action.kind === 'undo')

		// The card on screen must be the note the card is about: a pane that failed to switch keeps the old one.
		if (view === null || view.note.id !== this.#noteId || this.running !== null || this.loading) {
			return
		}

		this.running = action.kind

		try {
			const outcome = await sendAction(this.#api, view, { action, strings: this.#strings })

			// The pane moved on to another note meanwhile: this answer is no longer the card's.
			if (this.#noteId === view.note.id) {
				await this.#settle(view, outcome)
			}
		} finally {
			this.running = null
			this.#poller.update()
		}
	}

	public destroy(): void {
		this.#poller.stop()
		this.#sequence += 1
		this.#request?.abort()
		this.toasts.destroy()
	}

	/** The card an action applies to: Undo needs a card this controller deleted, the rest a card. */
	#actionView(isUndo: boolean): CardView | null {
		const { state } = this

		if (isUndo) {
			return state.kind === 'deleted' && state.canUndo ? state.view : null
		}

		return state.kind === 'card' ? state.view : null
	}

	async #settle(view: CardView, outcome: ActionOutcome) {
		switch (outcome.kind) {
			case 'done':
			case 'conflict': {
				await this.#refetch(view.note.id)

				if (outcome.kind === 'conflict') {
					this.toasts.show(this.#strings.conflictToast)
				} else {
					this.picked = outcome.depth ?? this.picked
					this.#toast(outcome.toast)
					this.#notesChanged()
				}

				break
			}

			case 'deleted': {
				this.state = { kind: 'deleted', view, canUndo: outcome.canUndo }
				this.#notesChanged()

				break
			}

			case 'missing': {
				this.state = { kind: 'missing' }
				this.#notesChanged()

				break
			}

			case 'signIn': {
				this.#signIn()

				break
			}

			case 'error': {
				this.toasts.show(outcome.toast, 'error')

				break
			}

			default: {
				throw new Error('An action ended in a way the card does not know.')
			}
		}
	}

	#toast(title: string | null) {
		if (title !== null) {
			this.toasts.show(title)
		}
	}

	async #refetch(id: number) {
		const result = await this.#load(id)

		if (result !== null) {
			this.#show(result, { quiet: false })
		}
	}

	/** The card of `id`, or `null` when a newer request replaced this one. */
	async #load(id: number): Promise<CardResult<CardView> | null> {
		this.#sequence += 1

		const sequence = this.#sequence
		const request = new AbortController()

		this.#request?.abort()
		this.#request = request

		const result = await this.#api.card(id, request.signal)

		if (sequence !== this.#sequence || id !== this.#noteId) {
			return null
		}

		this.#request = null

		return result
	}

	#show(result: CardResult<CardView>, { quiet }: { quiet: boolean }) {
		const previous = this.state.kind === 'card' ? this.state.view : null

		if (result.kind === 'ok') {
			this.state = { kind: 'card', view: result.value }

			const settled = !unsettled.has(result.value.note.status)

			// Research finished while the card was open: a list on the page shows the new status too.
			if (
				previous?.note.id === result.value.note.id &&
				unsettled.has(previous.note.status) &&
				settled
			) {
				this.#notesChanged()
			}
		} else if (result.kind === 'missing') {
			this.state = { kind: 'missing' }
		} else if (result.kind === 'unauthorized') {
			this.#signIn()
		} else if (!quiet) {
			this.toasts.show(this.#strings.loadFailedToast, 'error')
		}

		this.#poller.update()
	}
}
