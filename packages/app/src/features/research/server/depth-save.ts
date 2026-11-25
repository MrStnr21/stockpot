// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { and, eq, isNull } from 'drizzle-orm'

import type { Card } from '#/features/research/shared/formats'
import type { FormatId } from '#/lib/format-ids'
import type { Db } from '#/server/db/client'
import { explanations } from '#/server/db/schema/explanations'
import { notes } from '#/server/db/schema/notes'
import type { CardInput } from '#/server/engines/contract'
import { promptVersion } from '#/server/engines/prompt'
import type { CardResult } from '#/server/engines/router'

/** What saving a level needs of the task that asked for it (`DeeperTask` in depth.ts). */
interface LevelTask {
	readonly noteId: number
	readonly depth: 2 | 3
	readonly input: Pick<CardInput, 'output' | 'language'>
}

/**
 * Stores the level as a row of its own. Returns `null` when the note is gone or a finished card
 * already stands at that depth (jobs for the same level may finish in either order: the first one
 * wins). `firstWrite` is false when a draft stood there, which the new card replaces.
 */
export function saveLevel(
	db: Db,
	{ noteId, depth, input }: LevelTask,
	result: CardResult<Card<FormatId, 2 | 3>>,
): { firstWrite: boolean } | null {
	return db.transaction(
		(tx) => {
			const byId = eq(notes.id, noteId)

			const note = tx
				.select({ termId: notes.termId, status: notes.status })
				.from(notes)
				.where(and(byId, isNull(notes.deletedAt)))
				.get()

			if (note === undefined) {
				return null
			}

			const atDepth = and(eq(explanations.noteId, noteId), eq(explanations.depth, depth))

			const rows = tx
				.select({ isDraft: explanations.isDraft })
				.from(explanations)
				.where(atDepth)
				.all()

			if (rows.some((row) => !row.isDraft)) {
				return null
			}

			const { sources, uncertain, ...body } = result.output
			tx.delete(explanations)
				.where(and(atDepth, eq(explanations.isDraft, true)))
				.run()
			tx.insert(explanations)
				.values({
					noteId,
					termId: note.termId,
					format: input.output.id,
					depth,
					language: input.language,
					body,
					sources,
					isUncertain: uncertain,
					isDraft: result.draft,
					engine: result.engine,
					model: result.model,
					promptVersion,
					searchSuggestions: result.searchSuggestions,
				})
				.run()

			const firstWrite = rows.length === 0

			// A new level is unread. The status describes the first card, so nothing else changes it.
			if (firstWrite && note.status === 'read') {
				tx.update(notes).set({ status: 'ready' }).where(byId).run()
			}

			return { firstWrite }
		},
		{ behavior: 'immediate' },
	)
}
