// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { and, eq, isNull } from 'drizzle-orm'

import type { Card } from '#/features/research/shared/formats'
import type { FormatId } from '#/lib/format-ids'
import type { Db } from '#/server/db/client'
import { explanations } from '#/server/db/schema/explanations'
import { notes } from '#/server/db/schema/notes'
import { promptVersion } from '#/server/engines/prompt'
import type { CardResult } from '#/server/engines/router'

import type { ResearchTask } from './assemble'

export function save(
	db: Db,
	{ noteId, categoryId, input }: ResearchTask,
	result: CardResult<Card<FormatId, 1>>,
): { termId: number | null } | null {
	return db.transaction(
		(tx) => {
			const byId = eq(notes.id, noteId)

			const note = tx
				.select({ termId: notes.termId, categoryId: notes.categoryId, status: notes.status })
				.from(notes)
				.where(and(byId, isNull(notes.deletedAt)))
				.get()

			if (note === undefined) {
				return null
			}

			const { sources, uncertain, ...body } = result.output
			tx.delete(explanations)
				.where(
					and(
						eq(explanations.noteId, noteId),
						eq(explanations.depth, 1),
						eq(explanations.isDraft, true),
					),
				)
				.run()
			tx.insert(explanations)
				.values({
					noteId,
					termId: note.termId,
					format: input.output.id,
					depth: 1,
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
			tx.update(notes)
				.set({
					status: note.status === 'queued' || note.status === 'researching' ? 'ready' : note.status,
					categoryId: note.categoryId ?? categoryId,
				})
				.where(byId)
				.run()

			return { termId: note.termId }
		},
		{ behavior: 'immediate' },
	)
}
