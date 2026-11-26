// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

/*
 * Changing several notes at once from the list's select mode. The same rules as changing one note
 * (`changeNote`), answered per note instead of failing the whole request: a deleted note is never
 * restored, and a note the research job holds is not archived. Everything runs in one write
 * transaction, so an error part-way leaves every note as it was, and a repeat answers `unchanged`.
 */
import { and, inArray, isNull } from 'drizzle-orm'

import type { Db } from '#/server/db/client'
import { notes } from '#/server/db/schema/notes'

import type { BulkChange } from '../schemas'
import { canSetStatus, ownerTransitions, requireCategory } from '../server'
import { toPublicNote, type NoteRow, type PublicNote } from './public-note'

export type BulkOutcome = 'changed' | 'unchanged' | 'not_found' | 'conflict'

export interface BulkResult {
	readonly id: number
	readonly outcome: BulkOutcome
	/** The note after the change; null only for `not_found`. */
	readonly note: PublicNote | null
}

function outcomeFor(row: NoteRow | undefined, change: BulkChange): BulkOutcome {
	if (row === undefined || row.deletedAt !== null) {
		return 'not_found'
	}

	if ('categoryId' in change) {
		return row.categoryId === change.categoryId ? 'unchanged' : 'changed'
	}

	if (row.status === change.status) {
		return 'unchanged'
	}

	return canSetStatus(row.status, change.status) ? 'changed' : 'conflict'
}

/** Applies one change to each named note and answers each note's outcome in request order, once per id. */
export function changeNotes(db: Db, noteIds: readonly number[], change: BulkChange): BulkResult[] {
	const ids = [...new Set(noteIds)]

	return db.transaction(
		(tx) => {
			if ('categoryId' in change) {
				requireCategory(tx, change.categoryId)
			}

			const rows = new Map(
				tx
					.select()
					.from(notes)
					.where(inArray(notes.id, ids))
					.all()
					.map((row) => [row.id, row]),
			)

			const outcomes = ids.map((id) => ({ id, outcome: outcomeFor(rows.get(id), change) }))
			const changed = outcomes.flatMap(({ id, outcome }) => (outcome === 'changed' ? [id] : []))

			if (changed.length > 0) {
				const fields =
					'categoryId' in change ? { categoryId: change.categoryId } : { status: change.status }

				// The conditions repeat what was checked above, so the write can never do more than it answers.
				const allowed =
					'categoryId' in change
						? undefined
						: inArray(notes.status, ownerTransitions[change.status] ?? [])

				tx.update(notes)
					.set(fields)
					.where(and(inArray(notes.id, changed), isNull(notes.deletedAt), allowed))
					.run()

				for (const row of tx.select().from(notes).where(inArray(notes.id, changed)).all()) {
					rows.set(row.id, row)
				}
			}

			return outcomes.map(({ id, outcome }) => {
				const row = outcome === 'not_found' ? undefined : rows.get(id)

				return { id, outcome, note: row === undefined ? null : toPublicNote(row) }
			})
		},
		{ behavior: 'immediate' },
	)
}
