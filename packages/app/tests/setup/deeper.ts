// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { cardFactories } from '#tests/factories/cards'
import { explanationRowFactory } from '#tests/factories/explanations'
import type { TestDb } from '#tests/setup/db'

import type { Card } from '#/features/research/shared/formats'
import type { FormatId } from '#/lib/format-ids'
import type { explanations } from '#/server/db/schema/explanations'
import type { Depth } from '#/server/engines/contract'

/** What a sample card holds in every format and depth. */
type SampleCard = Pick<Card<'brief', 1>, 'sources' | 'uncertain'>

/**
 * Stores a sample card of `format` at `depth` for the note, as a finished card unless the overrides
 * say otherwise. The sample comes back too: it is what the next level's `previous` is built from.
 */
export async function storeCard(
	db: TestDb,
	{
		noteId,
		depth,
		format = 'brief',
		...overrides
	}: { noteId: number; depth: Depth; format?: FormatId } & Partial<
		typeof explanations.$inferInsert
	>,
): Promise<{ row: typeof explanations.$inferSelect; card: SampleCard }> {
	const card: SampleCard = cardFactories[format][depth].build()
	const { sources, uncertain, ...body } = card

	const row = await explanationRowFactory
		.transient({ db })
		.create({ noteId, format, depth, body, sources, isUncertain: uncertain, ...overrides })

	return { row, card }
}
