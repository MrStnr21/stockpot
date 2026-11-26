// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

/*
 * What a list row draws for a note: its category's look, and the line under the term, which is the
 * search snippet in results and otherwise the card's sense or where the note was seen.
 */
import type { CategoryColor, IconName } from '@stockpot/ui/icon'

import type { Messages } from '#/lib/i18n/en'

import type { NoteRow, NotesCategory, NoteStatus, SnippetSegment } from '../shared/types'

export type NotesListStrings = Messages['notes']

export interface CategoryLook {
	readonly color: CategoryColor
	readonly icon: IconName
}

/** A note without a category, or with one the list does not know, wears the Other look. */
export const otherLook: CategoryLook = { color: 'other', icon: 'other' }

export interface RowView {
	readonly look: CategoryLook
	/** The search snippet, drawn as text with its matches marked; null outside search results. */
	readonly segments: readonly SnippetSegment[] | null
	/** The line under the term when there is no snippet. */
	readonly subtitle: string | null
}

function filled(text: string | null): string | null {
	return text === null || text.trim() === '' ? null : text
}

export function rowView(row: NoteRow, categories: ReadonlyMap<number, NotesCategory>): RowView {
	const category = row.categoryId === null ? undefined : categories.get(row.categoryId)

	return {
		look: category === undefined ? otherLook : { color: category.color, icon: category.icon },
		segments: row.snippet,
		subtitle: row.snippet === null ? (filled(row.sense) ?? filled(row.context)) : null,
	}
}

/** Each status's label, as the badges and the filter chips show it. */
export function statusLabels(strings: NotesListStrings): Readonly<Record<NoteStatus, string>> {
	return {
		new: strings.statusNew,
		queued: strings.statusQueued,
		researching: strings.statusResearching,
		ready: strings.statusReady,
		read: strings.statusRead,
		failed: strings.statusFailed,
		archived: strings.statusArchived,
	}
}
