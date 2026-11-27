// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

/*
 * Base: the kept notes, most recently kept first, grouped by category. Every query reads the partial
 * index `notes_kept_at_idx`. The category is compared as `+category_id`, which stops SQLite from
 * switching to `notes_category_id_created_at_idx`: that index would read every note of the category
 * and sort them, where the kept index reads only the kept ones, already in order. Deleted notes are
 * never counted, previewed or found.
 */
import { and, count, desc, isNotNull, isNull, sql } from 'drizzle-orm'

import type { Db } from '#/server/db/client'
import { categories, notes } from '#/server/db/schema/notes'

import { defaultPageSize, encodeCursor, type BaseNotesQuery } from '../schemas'
import { toListed, type Found, type ListedNote, type NotesPage } from './list'
import { countMatches, selectMatches, snippetSegments, toFtsQuery } from './search'

/** How many of a group's most recently kept notes the overview shows. */
export const basePreviewSize = 3

/** One category's kept notes in the overview; `categoryId: null` holds the uncategorized ones. */
export interface BaseGroup {
	readonly categoryId: number | null
	/** Every kept note of the group, not only the previewed ones. */
	readonly count: number
	readonly notes: ListedNote[]
}

export interface BaseOverview {
	/** Every kept note. */
	readonly total: number
	/** In the owner's category order, the uncategorized group last; groups without kept notes are left out. */
	readonly groups: BaseGroup[]
}

interface KeptFilters {
	/** A category, `null` for the uncategorized notes, or `undefined` for every kept note. */
	readonly categoryId?: number | null
	readonly cursor?: BaseNotesQuery['cursor']
}

/** The conditions every Base query shares: kept, live, the category and the cursor. */
// oxlint-disable-next-line typescript/explicit-module-boundary-types -- A Drizzle condition; the queries take it as is.
export function keptFilters({ categoryId, cursor }: KeptFilters) {
	let inCategory

	if (categoryId === null) {
		inCategory = sql`+${notes.categoryId} IS NULL`
	} else if (categoryId !== undefined) {
		inCategory = sql`+${notes.categoryId} = ${categoryId}`
	}

	// The cursor's `createdAt` carries the kept time here.
	const afterCursor =
		cursor === undefined
			? undefined
			: sql`(${notes.keptAt}, ${notes.id}) < (${cursor.createdAt}, ${cursor.id})`

	return and(isNotNull(notes.keptAt), isNull(notes.deletedAt), inCategory, afterCursor)
}

const newestKept = [desc(notes.keptAt), desc(notes.id)]

interface KeptQuery extends KeptFilters {
	readonly limit: number
}

/** Kept notes, most recently kept first, one row past `limit`; exported so a spec can assert its plan. */
// oxlint-disable-next-line typescript/explicit-module-boundary-types -- The Drizzle query type is long; the readers run it.
export function selectKept(db: Db, { categoryId, cursor, limit }: KeptQuery) {
	return db
		.select()
		.from(notes)
		.where(keptFilters({ categoryId, cursor }))
		.orderBy(...newestKept)
		.limit(limit + 1)
}

/** How many notes each category keeps; exported so a spec can assert its plan. */
// oxlint-disable-next-line typescript/explicit-module-boundary-types -- The Drizzle query type is long; readBase runs it.
export function selectKeptCounts(db: Db) {
	const category = sql<number | null>`+${notes.categoryId}`.mapWith(notes.categoryId)

	return db
		.select({ categoryId: category, count: count() })
		.from(notes)
		.where(keptFilters({}))
		.groupBy(category)
}

/** How many notes one group keeps; exported so a spec can assert its plan. */
// oxlint-disable-next-line typescript/explicit-module-boundary-types -- The Drizzle query type is long; listKept runs it.
export function selectKeptCount(db: Db, categoryId: number | null | undefined) {
	return db.select({ count: count() }).from(notes).where(keptFilters({ categoryId }))
}

function categoryOrder(db: Db): number[] {
	return db
		.select({ id: categories.id })
		.from(categories)
		.orderBy(categories.position, categories.id)
		.all()
		.map(({ id }) => id)
}

function plainFound(rows: Found['row'][]): Found[] {
	return rows.map((row) => ({ row, snippet: null }))
}

/** The overview: every group's count and its most recently kept notes. */
export function readBase(db: Db): BaseOverview {
	const counts = new Map(
		selectKeptCounts(db)
			.all()
			.map(({ categoryId, count: kept }) => [categoryId, kept]),
	)

	// The owner's order, then a category the order does not know, then the uncategorized notes.
	const ordered = categoryOrder(db).filter((id) => counts.has(id))

	const others = [...counts.keys()].filter(
		(id): id is number => id !== null && !ordered.includes(id),
	)

	const groupIds = [...ordered, ...others, ...(counts.has(null) ? [null] : [])]

	const groups = groupIds.map((categoryId) => {
		const rows = selectKept(db, { categoryId, limit: basePreviewSize }).all()

		return {
			categoryId,
			count: counts.get(categoryId) ?? 0,
			notes: toListed(db, plainFound(rows.slice(0, basePreviewSize))),
		}
	})

	return { total: groups.reduce((sum, group) => sum + group.count, 0), groups }
}

interface FoundRows {
	/** Up to one row past the page. */
	readonly found: Found[]
	readonly limit: number
	readonly total: number
}

function toKeptPage(db: Db, { found, limit, total }: FoundRows): NotesPage {
	const page = found.slice(0, limit)
	// Only a page with a row past it has a next one.
	const last = found.length > limit ? page.at(-1)?.row : undefined

	return {
		notes: toListed(db, page),
		nextCursor: last?.keptAt ? encodeCursor({ createdAt: last.keptAt, id: last.id }) : null,
		total,
	}
}

/**
 * One page of Base: a group's kept notes with `categoryId` (a number, or `null` for the
 * uncategorized ones), or with `q` the kept notes that match it across every group. Both are most
 * recently kept first, and `total` counts the group or the matches.
 */
export function listKept(db: Db, query: BaseNotesQuery): NotesPage {
	const limit = query.limit ?? defaultPageSize
	const { categoryId, cursor } = query

	if (query.q === undefined) {
		const rows = selectKept(db, { categoryId, cursor, limit }).all()
		const total = selectKeptCount(db, categoryId).get()?.count ?? 0

		return toKeptPage(db, { found: plainFound(rows), limit, total })
	}

	const match = toFtsQuery(query.q)

	// Only punctuation or symbols: nothing to look for, and nothing to send to MATCH.
	if (match === null) {
		return { notes: [], nextCursor: null, total: 0 }
	}

	const matches = selectMatches(db, {
		match,
		where: keptFilters({ cursor }),
		limit: limit + 1,
		orderBy: newestKept,
	}).all()

	const found = matches.map(({ note, snippet }) => ({
		row: note,
		snippet: snippetSegments(snippet),
	}))

	const total = countMatches(db, { match, where: keptFilters({}) })

	return toKeptPage(db, { found, limit, total })
}
