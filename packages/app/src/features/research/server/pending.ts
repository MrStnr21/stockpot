// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import * as v from 'valibot'

import type { Db } from '#/server/db/client'
import { activeJobPayloads } from '#/server/jobs/queue'

import type { DeeperPayload } from './depth'
import type { ResearchPayload } from './pipeline'

const researchPayload = v.object({
	noteId: v.pipe(v.number(), v.integer()),
}) satisfies v.GenericSchema<unknown, ResearchPayload>

export function pendingResearchNoteIds(db: Db): Set<number> {
	const noteIds = new Set<number>()

	for (const payload of activeJobPayloads(db, 'research')) {
		const parsed = v.safeParse(researchPayload, payload)

		if (parsed.success) {
			noteIds.add(parsed.output.noteId)
		}
	}

	return noteIds
}

const deeperPayload = v.object({
	noteId: v.pipe(v.number(), v.integer()),
	depth: v.picklist([2, 3]),
	now: v.optional(v.literal(true)),
}) satisfies v.GenericSchema<unknown, DeeperPayload>

/** The queued and running deeper jobs. A row that does not parse is skipped. */
export function activeDeeperJobs(db: Db): DeeperPayload[] {
	const found: DeeperPayload[] = []

	for (const payload of activeJobPayloads(db, 'deeper')) {
		const parsed = v.safeParse(deeperPayload, payload)

		if (parsed.success) {
			found.push(parsed.output)
		}
	}

	return found
}
