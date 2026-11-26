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
import { CardLoads, refetches, settlement, type GoneState } from './card-settle'
import type { CardStrings } from './card-text'
import { CardToasts } from './card-toasts.svelte'
import { cardPoller, type CardPollerOptions, type Poller } from './poll'

export type CardState =
	/** The pane before a note is picked. */
	| { readonly kind: 'empty' }
	| { readonly kind: 'card'; readonly view: CardView }
	/**
	 * `deleted`: from this card or elsewhere; Undo only brings back what this card deleted.
	 * `missing`: there is no such note, or it was deleted before the card could show it.
	 */
	| GoneState
	/** The pane could not load the card of note `id`, which the list marks current: it offers Try again. */
	| { readonly kind: 'unreachable'; readonly id: number }

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
	readonly #loads: CardLoads
	readonly #strings: CardStrings
	readonly #signIn: () => void
	readonly #notesChanged: () => void
	readonly #poller: Poller

	#noteId: number | null

	public constructor(options: CardControllerOptions) {
		const notion = options.notion ?? 'off'

		this.#api = createCardApi({ fetch: options.fetch })
		this.#loads = new CardLoads(this.#api)
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
	}

	/** Starts polling in the browser, once the card is on the page. */
	public start(): void {
		this.#poller.update()
	}

	public pick(depth: Depth): void {
		this.picked = depth
	}

	/**
	 * The pane shows another note's card. Picking the note on screen, or the one on its way, again
	 * does nothing; after its card failed to load, it tries again.
	 */
	public async open(id: number): Promise<void> {
		const { kind } = this.state

		if (id === this.#noteId && (this.loading || (kind !== 'empty' && kind !== 'unreachable'))) {
			return
		}

		this.#noteId = id
		this.picked = 1
		this.loading = true

		const result = await this.#load(id)

		if (result !== null) {
			this.loading = false

			// The list and the URL already name this note: the old card must not stay with dead buttons.
			if (result.kind === 'failed') {
				this.state = { kind: 'unreachable', id }
			} else {
				this.#show(result, { quiet: false })
			}
		}
	}

	/** Try again on a card that failed to load. */
	public async retry(): Promise<void> {
		if (this.state.kind === 'unreachable') {
			await this.open(this.state.id)
		}
	}

	/**
	 * Polling, or notes changed elsewhere on the page: the card on screen again, quietly. An action's
	 * own fetch takes precedence, and a deleted card keeps its panel and its Undo.
	 */
	public async refresh(): Promise<void> {
		const id = this.#noteId

		if (id === null || this.state.kind !== 'card' || this.running !== null || this.loading) {
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
		// A poll on its way would answer from before the action: a 404 would take Undo away, a 200
		// would bring back a deleted card.
		this.#loads.cancel()

		try {
			const outcome = await sendAction(this.#api, view, { action, strings: this.#strings })

			await this.#settle(view, outcome)
		} finally {
			this.running = null
			this.#poller.update()
		}
	}

	public destroy(): void {
		this.#poller.stop()
		this.#loads.cancel()
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

	/** The pane may have moved on meanwhile: then only the list hears of it, and the card stays. */
	async #settle(view: CardView, outcome: ActionOutcome) {
		const { id } = view.note

		if (refetches(outcome) && this.#noteId === id) {
			const result = await this.#load(id)

			if (result !== null) {
				this.#show(result, { quiet: false })
			}
		}

		const onScreen = this.#noteId === id
		const settled = settlement(view, outcome, { onScreen, strings: this.#strings })

		this.state = settled.state ?? this.state
		this.picked = settled.depth ?? this.picked

		if (settled.toast !== null) {
			this.toasts.show(settled.toast.title, settled.toast.tone)
		}

		if (settled.notesChanged) {
			this.#notesChanged()
		}

		if (settled.signIn) {
			this.#signIn()
		}
	}

	/** The card of `id`, or `null` when a newer request replaced this one or the pane moved on. */
	async #load(id: number): Promise<CardResult<CardView> | null> {
		return this.#loads.load(id, () => id === this.#noteId)
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
