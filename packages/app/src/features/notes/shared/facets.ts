// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

/*
 * The counts on the filter chips and in the category sheet, all from one `GET /api/notes/counts`.
 * Each side follows the other filter: status chips count within the chosen category, categories count
 * within the chosen status. Counts ignore the search (boards 05 and 06 keep "All 128").
 */
import type { NoteFilters } from './filters'
import { listStatuses, type CountRow, type NoteStatus } from './types'

export interface StatusChip {
	readonly status: NoteStatus
	readonly count: number
}

export interface Facets {
	/** Every live note on the instance; none shows the empty list. */
	readonly total: number
	/** The "All" chip: every status within the category filter. */
	readonly all: number
	/** In chip order: each status with notes within the category filter, and the active one even without. */
	readonly statuses: readonly StatusChip[]
	/** "All categories": every note within the status filter, with a category or without. */
	readonly allCategories: number
	/** Notes per category within the status filter; a category with none is left out. */
	readonly categories: ReadonlyMap<number, number>
}

export function facetCounts(
	rows: readonly CountRow[],
	filters: Pick<NoteFilters, 'status' | 'categoryId'>,
): Facets {
	const byStatus = new Map<NoteStatus, number>()
	const categories = new Map<number, number>()
	let total = 0
	let all = 0
	let allCategories = 0

	for (const { categoryId, status, count } of rows) {
		total += count

		if (filters.categoryId === null || categoryId === filters.categoryId) {
			all += count
			byStatus.set(status, (byStatus.get(status) ?? 0) + count)
		}

		if (filters.status === null || status === filters.status) {
			allCategories += count

			if (categoryId !== null) {
				categories.set(categoryId, (categories.get(categoryId) ?? 0) + count)
			}
		}
	}

	const statuses = listStatuses.flatMap((status) => {
		const count = byStatus.get(status) ?? 0

		return count > 0 || status === filters.status ? [{ status, count }] : []
	})

	return { total, all, statuses, allCategories, categories }
}
