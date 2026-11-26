// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

/*
 * Indexed direct term matching keeps capture within its 50 ms p95 budget. Learned aliases are for
 * history because linking through one could combine context about distinct concepts.
 * Research happens later in a job. A delete sets `deleted_at` so the Undo toast can restore the
 * note. Deleted notes stay out of the list and answer 404 by id except when restoring them.
 */
import { and, eq, isNull } from 'drizzle-orm'

import { normalizeTerm } from '#/lib/normalize'
import type { Db } from '#/server/db/client'
import { categories, notes, terms, type NoteStatus } from '#/server/db/schema/notes'
import { HttpError } from '#/server/http'

import { maxNoteContextLength, type NewNote, type NoteChange } from './schemas'
import { findMergeTarget, findTermRows } from './server/history'
import { mergeContext } from './server/merge-context'
import { toPublicNote, type NoteRow, type PublicNote, type Queries } from './server/public-note'

export {
	bulkChangeSchema,
	newNoteSchema,
	noteChangeSchema,
	noteIdSchema,
	noteSources,
	notesQuerySchema,
	type BulkChange,
	type NewNote,
	type NoteChange,
	type NotesQuery,
} from './schemas'

export { getNote, listNotes, selectNotes, type ListedNote, type NotesPage } from './server/list'

export type { PublicNote } from './server/public-note'

function notFound() {
	return new HttpError(404, { code: 'not_found', message: 'There is no such note.' })
}

/** Answers 400 for a category that does not exist, before the foreign key could throw. */
export function requireCategory(db: Queries, categoryId: number): void {
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

function captureTerm(db: Queries, term: string, categoryId: number | null): number {
	const matches = findTermRows(db, term, 'direct')

	const preferred =
		matches.length === 1 || categoryId === null
			? matches
			: matches.filter(({ row }) => row.categoryId === categoryId)

	const match =
		preferred.length === 1
			? preferred[0]
			: matches.find(({ row }) => row.term === term && row.meaning === '')

	if (match !== undefined) {
		const { row } = match

		if (row.categoryId === null && categoryId !== null) {
			db.update(terms).set({ categoryId }).where(eq(terms.id, row.id)).run()
		}

		return row.id
	}

	db.insert(terms).values({ term, meaning: '', categoryId }).onConflictDoNothing().run()

	const key = and(eq(terms.term, term), eq(terms.meaning, ''))
	const stored = db.select({ id: terms.id }).from(terms).where(key).get()

	if (stored === undefined) {
		throw new Error('The term could not be saved.')
	}

	return stored.id
}

function mergeCapture(db: Queries, target: NoteRow, note: NewNote): NoteRow | undefined {
	const context = mergeContext(target, note)

	if (context !== null && context.length > maxNoteContextLength) {
		return undefined
	}

	const url = target.url ?? note.url
	const categoryId = target.categoryId ?? note.categoryId

	if (context === target.context && url === target.url && categoryId === target.categoryId) {
		return target
	}

	const updatedAt = new Date(Math.max(Date.now(), target.updatedAt.getTime() + 1))
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
			const termId = normalized === null ? null : captureTerm(tx, normalized, note.categoryId)
			const target = termId === null ? undefined : findMergeTarget(tx, termId, note.private)
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
					termId,
				})
				.returning()
				.get()

			return { note: toPublicNote(row), merged: false }
		},
		{ behavior: 'immediate' },
	)
}

/*
 * The statuses the owner sets, each with the statuses it may follow: read and unread, and archive.
 * `queued`, `researching` and `failed` belong to the research job (RES-1), and unarchiving is
 * "research now" (RES-3).
 */
export const ownerTransitions: Partial<Record<NoteStatus, readonly NoteStatus[]>> = {
	read: ['ready'],
	ready: ['read'],
	archived: ['new', 'ready', 'read', 'failed'],
}

export function canSetStatus(from: NoteStatus, to: NoteStatus): boolean {
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
