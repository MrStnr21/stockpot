// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

/*
 * Opening a note beside the list (768 and wider, WEB-5 decision 8): which clicks open it in the pane,
 * which row the arrow keys move to, and the `note` parameter that keeps the open note in the URL.
 */

/** The parts of a click that decide where a row link opens. */
export interface RowClick {
	readonly button: number
	readonly metaKey: boolean
	readonly ctrlKey: boolean
	readonly shiftKey: boolean
	readonly altKey: boolean
}

/** A plain primary click on a wide screen opens the card beside the list; any other keeps the link's own behaviour. */
export function opensInPane(click: RowClick, isWide: boolean): boolean {
	const modified = click.metaKey || click.ctrlKey || click.shiftKey || click.altKey

	return isWide && click.button === 0 && !modified
}

/** The row an arrow key moves to from row `from`, in the order the rows are drawn; `null` at the ends. */
export function nextRowId(ids: readonly number[], from: number, key: string): number | null {
	const index = ids.indexOf(from)
	const step = { ArrowDown: 1, ArrowUp: -1 }[key]

	if (index === -1 || step === undefined) {
		return null
	}

	return ids[index + step] ?? null
}

/** The list a card page was opened from, when it is not Notes: its back link returns there. */
export type NoteFrom = 'base'

/** A row's link to its note: `/notes/<id>`, with `?from=base` when the row is in Base. */
export function noteLink(id: number, from?: NoteFrom): string {
	return from === undefined ? `/notes/${id}` : `/notes/${id}?from=${from}`
}

/** The note a row link opens, from its `/notes/<id>` address (or `?from=base`); `null` for any other link. */
export function noteIdOfLink(href: string | null): number | null {
	const id = /^\/notes\/(?<id>[1-9]\d{0,14})(?:\?from=base)?$/u.exec(href ?? '')?.groups?.id

	return id === undefined ? null : Number(id)
}

export const noteParam = 'note'

/** The search with the open note set, or taken out for `null`; every other parameter stays. */
export function withNote(search: string, id: number | null): string {
	const params = new URLSearchParams(search)

	if (id === null) {
		params.delete(noteParam)
	} else {
		params.set(noteParam, String(id))
	}

	const query = params.toString()

	return query === '' ? '' : `?${query}`
}

/** A new filters search that keeps the open note of the current one. */
export function keepNote(search: string, current: string): string {
	const id = Number(new URLSearchParams(current).get(noteParam))

	return Number.isInteger(id) && id > 0 ? withNote(search, id) : search
}

/** Puts the filters' search into the page's URL; the note open beside the list stays open. */
export function replaceFiltersUrl(search: string): void {
	const { history, location } = globalThis
	const kept = keepNote(search, location.search)

	history.replaceState(history.state, '', `${location.pathname}${kept}${location.hash}`)
}
