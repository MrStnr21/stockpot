// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

/*
 * The notes list's own narrow shapes of what `GET /api/notes`, `GET /api/notes/counts`,
 * `PATCH /api/notes` and `POST /api/notes/research` send, so the browser bundle never depends on the
 * server modules that build them. Dates arrive as ISO strings, as JSON carries them.
 */
import type { CategoryColor, IconName } from '@stockpot/ui/icon'

import type { NoteStatus } from '#/server/db/schema/notes'

export type { NoteStatus } from '#/server/db/schema/notes'

/** Every status once, in the order the filter chips show them. */
export const listStatuses = [
	'new',
	'queued',
	'researching',
	'ready',
	'read',
	'failed',
	'archived',
] as const satisfies readonly NoteStatus[]

/* Fails to compile when the schema gains a status the chips do not place. */
type AssertNone<T extends never> = T

export type UnplacedStatus = AssertNone<Exclude<NoteStatus, (typeof listStatuses)[number]>>

/** What a row says about its card: a draft by a fallback engine wins over an unsure answer. */
export type NoteFlag = 'draft' | 'unsure'

/** A part of a search snippet; `match` parts are drawn marked. */
export interface SnippetSegment {
	readonly text: string
	readonly match: boolean
}

/** A note as the list shows it. */
export interface NoteRow {
	readonly id: number
	readonly text: string
	readonly context: string | null
	readonly url: string | null
	readonly source: string
	readonly categoryId: number | null
	readonly status: NoteStatus
	readonly private: boolean
	/** ISO 8601, as JSON carries a date. */
	readonly createdAt: string
	readonly updatedAt: string
	/** The meaning the newest first-level card explains. */
	readonly sense: string | null
	readonly flag: NoteFlag | null
	/** Only in search results: where the note matched. */
	readonly snippet: readonly SnippetSegment[] | null
}

/** One page of the list. */
export interface NotesPage {
	readonly notes: readonly NoteRow[]
	/** The cursor of the next page; `null` on the last one. */
	readonly nextCursor: string | null
	/** Only with a search: how many notes match under the filters. */
	readonly total: number | null
}

/** How many live notes share a category and a status. */
export interface CountRow {
	readonly categoryId: number | null
	readonly status: NoteStatus
	readonly count: number
}

/** A category as the list draws it, in the owner's order. */
export interface NotesCategory {
	readonly id: number
	readonly name: string
	readonly color: CategoryColor
	readonly icon: IconName
}

export type ResearchOutcome = 'queued' | 'pending' | 'done' | 'not_found'

/** What Research now did with one note. */
export interface ResearchResult {
	readonly id: number
	readonly outcome: ResearchOutcome
}

export type ChangeOutcome = 'changed' | 'unchanged' | 'not_found' | 'conflict'

/** The parts of a changed note the list follows. */
export interface ChangedNote {
	readonly status: NoteStatus
	readonly categoryId: number | null
}

/** What a bulk change did with one note; `note` is null only for `not_found`. */
export interface ChangeResult {
	readonly id: number
	readonly outcome: ChangeOutcome
	readonly note: ChangedNote | null
}

/** A bulk change: move to a category, or archive. */
export type NotesChange = { readonly categoryId: number } | { readonly status: 'archived' }

/** `fetch` as the list calls it: a path and, when there is one, a JSON body. */
export type JsonFetch = (
	url: string,
	init: RequestInit & { readonly body?: string },
) => Promise<Response>
