// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

/*
 * Bulk answers kept for the list answers still on their way. One clock stamps every list request
 * when it is sent and every bulk answer when it is applied. A list answer goes through each patch
 * stamped after its request, so a page the server read before a bulk change cannot undo it; a first
 * page sent after a patch carries the change itself, and its arrival drops the patch.
 */
import { rowMatchesFilters, type NoteFilters } from '../shared/filters'
import type { NoteRow, NoteStatus } from '../shared/types'

/** What a bulk answer did to one note: changed its status or category, or found it gone. */
export type RowPatch =
	| { readonly kind: 'remove' }
	| { readonly kind: 'set'; readonly status?: NoteStatus; readonly categoryId?: number | null }

interface StampedPatch {
	readonly stamp: number
	readonly patch: RowPatch
}

/** A removed note stays removed; otherwise the later fields win and the earlier ones stay. */
function combine(earlier: RowPatch | undefined, later: RowPatch): RowPatch {
	if (earlier?.kind === 'remove') {
		return earlier
	}

	if (earlier === undefined || later.kind === 'remove') {
		return later
	}

	return {
		kind: 'set',
		status: later.status ?? earlier.status,
		categoryId: later.categoryId === undefined ? earlier.categoryId : later.categoryId,
	}
}

/** The row after a patch, or null when it is gone or no longer belongs to the view. */
function patchRow(row: NoteRow, patch: RowPatch, filters: NoteFilters): NoteRow | null {
	if (patch.kind === 'remove') {
		return null
	}

	const patched = {
		...row,
		status: patch.status ?? row.status,
		categoryId: patch.categoryId === undefined ? row.categoryId : patch.categoryId,
	}

	return rowMatchesFilters(patched, filters) ? patched : null
}

function patchRows(
	rows: readonly NoteRow[],
	patchOf: (id: number) => RowPatch | undefined,
	filters: NoteFilters,
): NoteRow[] {
	return rows.flatMap((row) => {
		const patch = patchOf(row.id)
		const patched = patch === undefined ? row : patchRow(row, patch, filters)

		return patched === null ? [] : [patched]
	})
}

export class RowPatches {
	readonly #patches = new Map<number, StampedPatch>()

	#clock = 0

	/** The stamp of a list request being sent now. */
	public stamp(): number {
		this.#clock += 1

		return this.#clock
	}

	/**
	 * Keeps a bulk answer for the list answers still on their way, and answers the loaded rows after
	 * it: patched, without the notes that are gone or no longer match the filters.
	 */
	public record(
		patches: ReadonlyMap<number, RowPatch>,
		rows: readonly NoteRow[],
		filters: NoteFilters,
	): NoteRow[] {
		const stamp = this.stamp()

		for (const [id, patch] of patches) {
			this.#patches.set(id, { stamp, patch: combine(this.#patches.get(id)?.patch, patch) })
		}

		return patchRows(rows, (id) => patches.get(id), filters)
	}

	/** Rows of a list answer, through the patches applied after its request was sent. */
	public merge(rows: readonly NoteRow[], sentAt: number, filters: NoteFilters): NoteRow[] {
		return patchRows(
			rows,
			(id) => {
				const stamped = this.#patches.get(id)

				return stamped === undefined || stamped.stamp < sentAt ? undefined : stamped.patch
			},
			filters,
		)
	}

	/** A first page sent at `sentAt` arrived: the server already showed it every older patch. */
	public dropBefore(sentAt: number): void {
		for (const [id, { stamp }] of this.#patches) {
			if (stamp < sentAt) {
				this.#patches.delete(id)
			}
		}
	}
}
