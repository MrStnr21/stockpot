// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

/*
 * The list's select mode: note ids in the order they were picked. The selection is keyed by id, not
 * by row, so it survives refetches, more pages, filter and search changes; a selected note out of view
 * stays selected and is acted on. There is no select-all (no board has one).
 */

/** The bulk routes take at most 100 notes. */
export const maxSelected = 100

export interface Selection {
	readonly isActive: boolean
	readonly ids: readonly number[]
}

export const noSelection: Selection = { isActive: false, ids: [] }

export interface SelectOutcome {
	readonly selection: Selection
	/** The note was not added: 100 are selected already. */
	readonly isRefused: boolean
}

/** "Select": select mode with nothing selected yet. */
export function startSelecting(selection: Selection): Selection {
	return selection.isActive ? selection : { isActive: true, ids: [] }
}

/** A tap on a row in select mode: selects it, or lets it go. */
export function toggleNote(selection: Selection, id: number): SelectOutcome {
	if (selection.ids.includes(id)) {
		return {
			selection: { ...selection, ids: selection.ids.filter((selected) => selected !== id) },
			isRefused: false,
		}
	}

	return addNote(selection, id)
}

/** A long press on a row: select mode with that row selected. */
export function pressNote(selection: Selection, id: number): SelectOutcome {
	return selection.ids.includes(id)
		? { selection: { ...selection, isActive: true }, isRefused: false }
		: addNote(selection, id)
}

function addNote(selection: Selection, id: number): SelectOutcome {
	if (selection.ids.length >= maxSelected) {
		return { selection: { ...selection, isActive: true }, isRefused: true }
	}

	return { selection: { isActive: true, ids: [...selection.ids, id] }, isRefused: false }
}

/** After a bulk answer: only these notes stay selected, and select mode ends when none do. */
export function keepSelected(selection: Selection, keep: ReadonlySet<number>): Selection {
	const ids = selection.ids.filter((id) => keep.has(id))

	return ids.length === 0 ? noSelection : { isActive: true, ids }
}
