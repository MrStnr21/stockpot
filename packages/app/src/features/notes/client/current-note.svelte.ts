// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

/*
 * The note open beside the list (768 and wider). A plain click on a row, or an arrow key on a focused
 * row, opens its card in the pane without leaving the list: the row is marked current, the pane hears
 * of it by `noteOpenedEvent`, and the URL keeps it for a reload. Narrower screens follow the link.
 */
import { noteOpened } from '#/lib/events'

import { nextRowId, noteIdOfLink, opensInPane, withNote, type RowClick } from './open-note'

export interface CurrentNoteOptions {
	/** The note the page opened from its URL. */
	readonly initial: number | null
	/** Whether the card opens beside the list; by default from 48rem up. */
	readonly isWide?: () => boolean
	/** Tells the pane; by default it sends `noteOpenedEvent`. */
	readonly announce?: (id: number) => void
	/** Puts the note into the URL; by default with `replaceState`, next to the filters. */
	readonly writeUrl?: (id: number) => void
}

/** The parts of an event a handler may cancel. */
interface Cancelable {
	readonly preventDefault: () => void
}

/** Where an arrow key was pressed: the rows as drawn, and the focused row. */
export interface RowKeyContext {
	readonly ids: readonly number[]
	readonly from: number
	/** Select mode: a key there never opens a note. */
	readonly selecting: boolean
}

function wideScreen() {
	return globalThis.matchMedia('(min-width: 48rem)').matches
}

function sendOpened(id: number) {
	globalThis.dispatchEvent(noteOpened(id))
}

function replaceUrl(id: number) {
	const { history, location } = globalThis
	const search = withNote(location.search, id)

	history.replaceState(history.state, '', `${location.pathname}${search}${location.hash}`)
}

export class CurrentNote {
	public current = $state.raw<number | null>(null)

	readonly #isWide: () => boolean
	readonly #announce: (id: number) => void
	readonly #writeUrl: (id: number) => void

	public constructor(options: CurrentNoteOptions) {
		this.current = options.initial
		this.#isWide = options.isWide ?? wideScreen
		this.#announce = options.announce ?? sendOpened
		this.#writeUrl = options.writeUrl ?? replaceUrl
	}

	/** A click on a row link; on the current row the pane opens nothing new unless its card failed to load. */
	public click(event: RowClick & Cancelable, id: number): void {
		if (!opensInPane(event, this.#isWide())) {
			return
		}

		event.preventDefault()
		this.open(id)
	}

	/** An arrow key on a focused row: opens the next row and returns its id to focus, else `null`. */
	public key(event: { readonly key: string } & Cancelable, context: RowKeyContext): number | null {
		const next =
			context.selecting || !this.#isWide() ? null : nextRowId(context.ids, context.from, event.key)

		if (next === null) {
			return null
		}

		event.preventDefault()
		this.open(next)

		return next
	}

	/**
	 * The current row is announced again with the URL left as it is: the pane ignores a note it
	 * shows, and loads it again after its card failed to load.
	 */
	public open(id: number): void {
		if (id !== this.current) {
			this.current = id
			this.#writeUrl(id)
		}

		this.#announce(id)
	}

	/**
	 * A key down in the list: an arrow key on a focused row link opens the next row and moves the
	 * focus to it. Nothing happens while a dialog is open.
	 */
	public keydown(
		event: KeyboardEvent,
		rows: readonly { readonly id: number }[],
		selecting: boolean,
	): void {
		const link = event.target instanceof Element ? event.target.closest('a') : null
		const from = noteIdOfLink(link?.getAttribute('href') ?? null)

		if (from === null || document.querySelector('dialog[open]') !== null) {
			return
		}

		const ids = rows.map(({ id }) => id)
		const next = this.key(event, { ids, from, selecting })

		if (next !== null && event.currentTarget instanceof Element) {
			event.currentTarget.querySelector<HTMLElement>(`a[href="/notes/${next}"]`)?.focus()
		}
	}
}
