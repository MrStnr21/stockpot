// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { and, desc, eq, inArray, isNotNull, isNull, or } from 'drizzle-orm'

import { normalizeTerm, termVariants } from '#/lib/normalize'
import type { Db } from '#/server/db/client'
import { explanations, type CardSource } from '#/server/db/schema/explanations'
import { aliases, notes, terms, type NoteStatus } from '#/server/db/schema/notes'

/*
 * A note is shown once `first_shown_at` is set or its status is `read`. The merge target is the
 * newest unshown note in `new`, `queued`, `researching`, `ready` or `failed` with the capture's
 * privacy when specified. History is `saved` with a merge target, `seen` with a shown note, and
 * `known` otherwise. Terms need a live note or card to appear. A learned alias may link distinct
 * concepts, so it can surface history while captures use direct matches only.
 */

export interface HistoryNote {
	readonly id: number
	readonly text: string
	readonly status: NoteStatus
	readonly private: boolean
	readonly createdAt: Date
}

export interface HistoryCard {
	readonly id: number
	readonly noteId: number | null
	readonly format: string
	readonly body: unknown
	readonly sources: CardSource[]
	readonly isUncertain: boolean
	readonly isDraft: boolean
	readonly createdAt: Date
}

export interface HistoryMatch {
	readonly termId: number
	readonly term: string
	readonly meaning: string
	readonly categoryId: number | null
	readonly state: 'saved' | 'seen' | 'known'
	readonly note: HistoryNote | null
	readonly lastCard: HistoryCard | null
}

type Queries = Pick<Db, 'select'>

type TermRow = typeof terms.$inferSelect

type NoteRow = typeof notes.$inferSelect

interface TermMatch {
	readonly row: TermRow
	readonly learned: boolean
}

/** Capture and history share the same indexed lookup for normalized terms and their aliases. */
export function findTermRows(
	db: Queries,
	term: string,
	scope: 'all' | 'direct' = 'all',
): TermMatch[] {
	const variants = termVariants(term)
	const rows = db.select().from(terms).where(inArray(terms.term, variants)).all()
	const direct = rows.map((row) => ({ row, learned: false }))

	if (scope === 'direct') {
		return direct
	}

	const aliased = db
		.select({ term: terms })
		.from(aliases)
		.innerJoin(terms, eq(terms.id, aliases.termId))
		.where(inArray(aliases.alias, variants))
		.all()

	const byId = new Map<number, TermMatch>(direct.map((match) => [match.row.id, match]))

	for (const { term: row } of aliased) {
		if (!byId.has(row.id)) {
			byId.set(row.id, { row, learned: true })
		}
	}

	return [...byId.values()]
}

const mergeableStatuses: NoteStatus[] = ['new', 'queued', 'researching', 'ready', 'failed']

/** Capture can restrict the merge target to notes with the same privacy setting. */
export function findMergeTarget(
	db: Queries,
	termId: number,
	isPrivate?: boolean,
): NoteRow | undefined {
	return db
		.select()
		.from(notes)
		.where(
			and(
				eq(notes.termId, termId),
				isNull(notes.deletedAt),
				isNull(notes.firstShownAt),
				inArray(notes.status, mergeableStatuses),
				isPrivate === undefined ? undefined : eq(notes.isPrivate, isPrivate),
			),
		)
		.orderBy(desc(notes.createdAt), desc(notes.id))
		.limit(1)
		.get()
}

function findLastCard(db: Queries, termId: number): HistoryCard | null {
	const noteIds = db
		.select({ id: notes.id })
		.from(notes)
		.where(and(eq(notes.termId, termId), isNull(notes.deletedAt)))

	const subject = or(eq(explanations.termId, termId), inArray(explanations.noteId, noteIds))

	return (
		db
			.select({
				id: explanations.id,
				noteId: explanations.noteId,
				format: explanations.format,
				body: explanations.body,
				sources: explanations.sources,
				isUncertain: explanations.isUncertain,
				isDraft: explanations.isDraft,
				createdAt: explanations.createdAt,
			})
			.from(explanations)
			.leftJoin(notes, eq(explanations.noteId, notes.id))
			.where(and(eq(explanations.depth, 1), isNull(notes.deletedAt), subject))
			.orderBy(desc(explanations.createdAt), desc(explanations.id))
			.limit(1)
			.get() ?? null
	)
}

function toHistoryNote(row: NoteRow): HistoryNote {
	return {
		id: row.id,
		text: row.text,
		status: row.status,
		private: row.isPrivate,
		createdAt: row.createdAt,
	}
}

function historyForTerm(db: Queries, match: TermMatch, isPrivate?: boolean): HistoryMatch {
	const { row: term, learned } = match
	const mergeTarget = learned ? undefined : findMergeTarget(db, term.id, isPrivate)
	const shown = or(isNotNull(notes.firstShownAt), eq(notes.status, 'read'))

	const note =
		mergeTarget ??
		db
			.select()
			.from(notes)
			.where(and(eq(notes.termId, term.id), isNull(notes.deletedAt), shown))
			.orderBy(desc(notes.createdAt), desc(notes.id))
			.limit(1)
			.get()

	const state = mergeTarget === undefined ? 'seen' : 'saved'

	return {
		termId: term.id,
		term: term.term,
		meaning: term.meaning,
		categoryId: term.categoryId,
		state: note === undefined ? 'known' : state,
		note: note === undefined ? null : toHistoryNote(note),
		lastCard: findLastCard(db, term.id),
	}
}

function hasTermCard(db: Queries, termId: number): boolean {
	const card = db
		.select({ id: explanations.id })
		.from(explanations)
		.leftJoin(notes, eq(explanations.noteId, notes.id))
		.where(and(eq(explanations.termId, termId), isNull(notes.deletedAt)))
		.limit(1)
		.get()

	return card !== undefined
}

/** A read transaction keeps the notes, cards and ordering on the same snapshot. */
export function matchHistory(db: Db, text: string, isPrivate?: boolean): HistoryMatch[] {
	const term = normalizeTerm(text)

	if (term === null) {
		return []
	}

	return db.transaction((tx) => {
		const matches = findTermRows(tx, term).map(({ row, learned }) => ({
			row,
			learned,
			newest: tx
				.select({ id: notes.id, createdAt: notes.createdAt })
				.from(notes)
				.where(and(eq(notes.termId, row.id), isNull(notes.deletedAt)))
				.orderBy(desc(notes.createdAt), desc(notes.id))
				.limit(1)
				.get(),
		}))

		return matches
			.toSorted((left, right) => {
				const leftTime = left.newest?.createdAt.getTime() ?? Number.NEGATIVE_INFINITY
				const rightTime = right.newest?.createdAt.getTime() ?? Number.NEGATIVE_INFINITY

				return (
					rightTime - leftTime ||
					(right.newest?.id ?? 0) - (left.newest?.id ?? 0) ||
					left.row.id - right.row.id
				)
			})
			.flatMap((match) => {
				const history = historyForTerm(tx, match, isPrivate)

				return match.newest !== undefined ||
					history.lastCard !== null ||
					hasTermCard(tx, match.row.id)
					? [history]
					: []
			})
	})
}
