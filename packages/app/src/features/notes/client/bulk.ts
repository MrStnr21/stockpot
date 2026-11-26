// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

/*
 * What a bulk answer means for the list. Rows change only from the answer, never before it: each
 * result becomes a patch for its row, and the selection keeps only the notes the action could not
 * reach because research holds them.
 */
import type {
	ChangeResult,
	NoteRow,
	NotesChange,
	NoteStatus,
	ResearchResult,
} from '../shared/types'
import type { ApiResult, NotesApi } from './notes-api'
import type { RowPatch } from './row-patches'

export type BulkAction =
	| { readonly kind: 'research' }
	| { readonly kind: 'archive' }
	| { readonly kind: 'move'; readonly categoryId: number }

export interface BulkSummary {
	readonly action: BulkAction
	/** The notes the action reached. */
	readonly done: number
	/** Archive only: the notes research holds, left as they were. */
	readonly conflicts: number
	/** The notes deleted elsewhere since they were selected. */
	readonly deleted: number
}

export interface BulkSettlement {
	readonly patches: ReadonlyMap<number, RowPatch>
	/** The notes that stay selected. */
	readonly keep: ReadonlySet<number>
	readonly summary: BulkSummary
}

const removed: RowPatch = { kind: 'remove' }

/** The body of `PATCH /api/notes` for a move or the archive. */
export function changeFor(action: Exclude<BulkAction, { kind: 'research' }>): NotesChange {
	return action.kind === 'move' ? { categoryId: action.categoryId } : { status: 'archived' }
}

/*
 * Mirrors what `POST /api/notes/research` did: a queued note is `queued`; an archived note comes back,
 * as `queued` when its job was pending and as `ready` when its card was done; any other note keeps its
 * status. The status before is read from the loaded row, so a note out of view gets only the sure part.
 */
function researchPatch(
	result: ResearchResult,
	statusOf: (id: number) => NoteStatus | undefined,
): RowPatch | null {
	const isArchived = statusOf(result.id) === 'archived'

	switch (result.outcome) {
		case 'queued': {
			return { kind: 'set', status: 'queued' }
		}

		case 'pending': {
			return isArchived ? { kind: 'set', status: 'queued' } : null
		}

		case 'done': {
			return isArchived ? { kind: 'set', status: 'ready' } : null
		}

		case 'not_found': {
			return removed
		}

		default: {
			return null
		}
	}
}

export function settleResearch(
	results: readonly ResearchResult[],
	statusOf: (id: number) => NoteStatus | undefined,
): BulkSettlement {
	const patches = new Map<number, RowPatch>()

	for (const result of results) {
		const patch = researchPatch(result, statusOf)

		if (patch !== null) {
			patches.set(result.id, patch)
		}
	}

	const deleted = results.filter(({ outcome }) => outcome === 'not_found').length

	return {
		patches,
		keep: new Set(),
		summary: {
			action: { kind: 'research' },
			done: results.length - deleted,
			conflicts: 0,
			deleted,
		},
	}
}

/** `changed` and `unchanged` take the note as answered, `not_found` goes, `conflict` stays selected. */
export function settleChange(
	action: Exclude<BulkAction, { kind: 'research' }>,
	results: readonly ChangeResult[],
): BulkSettlement {
	const patches = new Map<number, RowPatch>()
	const keep = new Set<number>()
	let done = 0
	let deleted = 0

	for (const { id, outcome, note } of results) {
		if (outcome === 'conflict') {
			keep.add(id)
		} else if (outcome === 'not_found' || note === null) {
			deleted += 1
			patches.set(id, removed)
		} else {
			done += 1
			patches.set(id, { kind: 'set', status: note.status, categoryId: note.categoryId })
		}
	}

	return { patches, keep, summary: { action, done, conflicts: keep.size, deleted } }
}

function settled<T>(
	result: ApiResult<T>,
	settle: (value: T) => BulkSettlement,
): ApiResult<BulkSettlement> {
	return result.kind === 'ok' ? { kind: 'ok', value: settle(result.value) } : result
}

export interface BulkRequest {
	readonly action: BulkAction
	/** The selected notes, in the order they were picked. */
	readonly ids: readonly number[]
	/** The loaded rows when the answer arrives: research reads their statuses before it. */
	readonly rows: () => readonly NoteRow[]
}

/** Sends one bulk action and reads its answer into patches, the notes kept selected and a summary. */
export async function sendBulk(
	api: Pick<NotesApi, 'researchNow' | 'changeNotes'>,
	{ action, ids, rows }: BulkRequest,
): Promise<ApiResult<BulkSettlement>> {
	if (action.kind === 'research') {
		const result = await api.researchNow(ids)

		return settled(result, (results) => {
			const statuses = new Map(rows().map(({ id, status }) => [id, status]))

			return settleResearch(results, (id) => statuses.get(id))
		})
	}

	const result = await api.changeNotes(ids, changeFor(action))

	return settled(result, (results) => settleChange(action, results))
}
