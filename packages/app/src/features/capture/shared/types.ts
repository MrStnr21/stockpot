// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

/*
 * The parts of the API answers the capture sheet reads. They are the client's own narrow shapes of
 * what `POST /api/suggest` and `POST /api/notes` send, so the browser bundle never depends on the
 * server modules that build them.
 */
import type { NoteStatus } from '#/server/db/schema/notes'

export interface SuggestSense {
	readonly sense: string
	readonly categoryId: number
}

export interface SuggestHistoryNote {
	readonly id: number
	readonly status: NoteStatus
}

export interface SuggestHistoryCard {
	readonly noteId: number | null
	/** The meaning the card was written for (`body.sense`), when the body names one. */
	readonly sense: string | null
}

/** A term the owner captured before: `saved` waits for its research, `seen` was shown already. */
export interface SuggestHistoryMatch {
	readonly term: string
	readonly meaning: string
	readonly categoryId: number | null
	readonly state: 'saved' | 'seen' | 'known'
	readonly note: SuggestHistoryNote | null
	readonly lastCard: SuggestHistoryCard | null
}

export interface SuggestAnswer {
	readonly history: readonly SuggestHistoryMatch[]
	/** Up to three category ids, best first. */
	readonly categories: readonly number[]
	/** None, or two to four meanings when the term has several. */
	readonly senses: readonly SuggestSense[]
	readonly language: string | null
	readonly source: 'history' | 'engine' | 'none'
	/** The engine is still answering; the same request again answers from the server's cache. */
	readonly pending: boolean
}

/** A note as `POST /api/notes` answers it. */
export interface SavedNote {
	readonly id: number
	readonly text: string
	readonly categoryId: number | null
	readonly private: boolean
}

/** `fetch` as the capture client calls it: a path and, when there is one, a JSON body. */
export type JsonFetch = (
	url: string,
	init: RequestInit & { readonly body?: string },
) => Promise<Response>
