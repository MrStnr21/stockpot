// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

/*
 * Indexed term matching lets the save path link or merge a capture within its 50 ms p95 budget.
 * Research happens later in a job. A delete sets `deleted_at` so the Undo toast can restore the
 * note. Deleted notes stay out of the list and answer 404 by id except when restoring them.
 */
import { and, desc, eq, isNull, sql } from 'drizzle-orm'

import { normalizeTerm } from '#/lib/normalize'
import type { Db } from '#/server/db/client'
import { categories, notes, terms, type NoteStatus } from '#/server/db/schema/notes'
import { HttpError } from '#/server/http'

import {
	defaultPageSize,
	encodeCursor,
	maxNoteContextLength,
	type NewNote,
	type NoteChange,
	type NotesQuery,
} from './schemas'
import { findMergeTarget, findTermRows } from './server/history'

export {
	newNoteSchema,
	noteChangeSchema,
	noteIdSchema,
	noteSources,
	notesQuerySchema,
	type NewNote,
	type NoteChange,
	type NotesQuery,
} from './schemas'

/** A note as it leaves the server. */
export interface PublicNote {
	readonly id: number
	readonly text: string
	readonly context: string | null
	readonly url: string | null
	readonly source: string
	readonly categoryId: number | null
	readonly status: NoteStatus
	readonly private: boolean
	readonly createdAt: Date
	readonly updatedAt: Date
}

type NoteRow = typeof notes.$inferSelect

function toPublicNote(row: NoteRow): PublicNote {
	return {
		id: row.id,
		text: row.text,
		context: row.context,
		url: row.url,
		source: row.source,
		categoryId: row.categoryId,
		status: row.status,
		private: row.isPrivate,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
	}
}

/** The database or a transaction on it: both run the same synchronous queries. */
type Queries = Db | Parameters<Parameters<Db['transaction']>[0]>[0]

function notFound() {
	return new HttpError(404, { code: 'not_found', message: 'There is no such note.' })
}

/** Answers 400 for a category that does not exist, before the foreign key could throw. */
function requireCategory(db: Queries, categoryId: number) {
	const category = db
		.select({ id: categories.id })
		.from(categories)
		.where(eq(categories.id, categoryId))
		.get()

	if (category === undefined) {
		throw new HttpError(400, {
			code: 'invalid_body',
			message: 'The body does not match what this route accepts.',
			issues: ['categoryId: There is no such category.'],
		})
	}
}

function captureTerm(db: Queries, term: string, categoryId: number | null) {
	const matches = findTermRows(db, term)

	const preferred =
		matches.length === 1 ? matches : matches.filter(({ row }) => row.categoryId === categoryId)

	const match =
		preferred.length === 1
			? preferred[0]
			: matches.find(({ row }) => row.term === term && row.meaning === '')

	if (match !== undefined) {
		const { row, learned } = match

		if (row.categoryId === null && categoryId !== null) {
			db.update(terms).set({ categoryId }).where(eq(terms.id, row.id)).run()
		}

		return { id: row.id, learned }
	}

	db.insert(terms).values({ term, meaning: '', categoryId }).onConflictDoNothing().run()

	const key = and(eq(terms.term, term), eq(terms.meaning, ''))
	const stored = db.select({ id: terms.id }).from(terms).where(key).get()

	if (stored === undefined) {
		throw new Error('The term could not be saved.')
	}

	return { id: stored.id, learned: false }
}

function mergeCapture(db: Queries, target: NoteRow, note: NewNote): NoteRow | undefined {
	let { context } = target

	if (note.context !== null && note.context !== '' && context?.includes(note.context) !== true) {
		context = context === null || context === '' ? note.context : `${context}\n\n${note.context}`
	}

	if (context !== null && context.length > maxNoteContextLength) {
		return undefined
	}

	const updatedAt = new Date(Math.max(Date.now(), target.updatedAt.getTime() + 1))
	const url = target.url ?? note.url
	const categoryId = target.categoryId ?? note.categoryId
	const fields = { context, url, categoryId, updatedAt }

	return db.update(notes).set(fields).where(eq(notes.id, target.id)).returning().get()
}

/** A write lock keeps term selection and the merge target stable until the capture commits. */
export function createNote(db: Db, note: NewNote): { note: PublicNote; merged: boolean } {
	return db.transaction(
		(tx) => {
			if (note.categoryId !== null) {
				requireCategory(tx, note.categoryId)
			}

			const normalized = normalizeTerm(note.text)
			const term = normalized === null ? null : captureTerm(tx, normalized, note.categoryId)

			const target =
				term?.learned === false ? findMergeTarget(tx, term.id, note.private) : undefined

			const merged = target === undefined ? undefined : mergeCapture(tx, target, note)

			if (merged !== undefined) {
				return { note: toPublicNote(merged), merged: true }
			}

			const row = tx
				.insert(notes)
				.values({
					text: note.text,
					context: note.context,
					url: note.url,
					source: note.source,
					categoryId: note.categoryId,
					isPrivate: note.private,
					termId: term?.id ?? null,
				})
				.returning()
				.get()

			return { note: toPublicNote(row), merged: false }
		},
		{ behavior: 'immediate' },
	)
}

/**
 * The list query, newest first, one row past the page so the page knows whether another follows.
 * Exported so a spec can assert that each filter reads its index: `created_at` alone, or after
 * `status` or `category_id`, with the id as the tie-break that every index already ends with.
 */
// oxlint-disable-next-line typescript/explicit-module-boundary-types -- The Drizzle query type is long; listNotes runs it.
export function selectNotes(db: Db, { status, categoryId, cursor, limit }: NotesQuery) {
	const afterCursor =
		cursor === undefined
			? undefined
			: sql`(${notes.createdAt}, ${notes.id}) < (${cursor.createdAt}, ${cursor.id})`

	return db
		.select()
		.from(notes)
		.where(
			and(
				isNull(notes.deletedAt),
				status === undefined ? undefined : eq(notes.status, status),
				categoryId === undefined ? undefined : eq(notes.categoryId, categoryId),
				afterCursor,
			),
		)
		.orderBy(desc(notes.createdAt), desc(notes.id))
		.limit((limit ?? defaultPageSize) + 1)
}

export interface NotesPage {
	readonly notes: PublicNote[]
	/** Pass as `cursor` for the next page; `null` on the last one. */
	readonly nextCursor: string | null
}

/** One page of the notes that are not deleted, newest first. */
export function listNotes(db: Db, query: NotesQuery): NotesPage {
	const limit = query.limit ?? defaultPageSize
	const rows = selectNotes(db, query).all()
	const page = rows.slice(0, limit)
	const last = page.at(-1)

	return {
		notes: page.map((row) => toPublicNote(row)),
		nextCursor: rows.length > limit && last !== undefined ? encodeCursor(last) : null,
	}
}

/*
 * The statuses the owner sets, each with the statuses it may follow: read and unread, and archive.
 * `queued`, `researching` and `failed` belong to the research job (RES-1), and unarchiving is
 * "research now" (RES-3).
 */
const ownerTransitions: Partial<Record<NoteStatus, readonly NoteStatus[]>> = {
	read: ['ready'],
	ready: ['read'],
	archived: ['new', 'ready', 'read', 'failed'],
}

function canSetStatus(from: NoteStatus, to: NoteStatus) {
	return ownerTransitions[to]?.includes(from) ?? false
}

/**
 * Changes a note's category or status, or restores it after a delete. A deleted note answers 404
 * unless the change restores it; a status the owner may not set from the current one answers 409.
 */
export function changeNote(db: Db, id: number, change: NoteChange): PublicNote {
	return db.transaction((tx) => {
		const note = tx.select().from(notes).where(eq(notes.id, id)).get()
		const isRestore = change.deleted === false

		if (note === undefined || (note.deletedAt !== null && !isRestore)) {
			throw notFound()
		}

		if (change.categoryId !== undefined && change.categoryId !== null) {
			requireCategory(tx, change.categoryId)
		}

		if (change.status !== undefined && !canSetStatus(note.status, change.status)) {
			throw new HttpError(409, {
				code: 'status_conflict',
				message: `A note with status ${note.status} cannot be set to ${change.status}.`,
			})
		}

		const row = tx
			.update(notes)
			.set({
				categoryId: change.categoryId,
				status: change.status,
				deletedAt: isRestore ? null : undefined,
			})
			.where(eq(notes.id, id))
			.returning()
			.get()

		return toPublicNote(row ?? note)
	})
}

/** Soft-deletes a note; a note that does not exist or is deleted already answers 404. */
export function deleteNote(db: Db, id: number): void {
	const deleted = db
		.update(notes)
		.set({ deletedAt: new Date() })
		.where(and(eq(notes.id, id), isNull(notes.deletedAt)))
		.returning({ id: notes.id })
		.get()

	if (deleted === undefined) {
		throw notFound()
	}
}
