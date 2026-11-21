// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import * as v from 'valibot'

import type { Db } from '#/server/db/client'
import { activeJobPayloads } from '#/server/jobs/queue'

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
