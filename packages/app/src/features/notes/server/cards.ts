// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

/*
 * What a list row shows of a note's card: the sense and the flag of its newest first-level card. They
 * are read for a whole page in one query after the page, so the list query keeps its plan.
 */
import { and, eq, inArray } from 'drizzle-orm'
import * as v from 'valibot'

import type { Db } from '#/server/db/client'
import { explanations } from '#/server/db/schema/explanations'

export type CardFlag = 'draft' | 'unsure'

export interface CardFacts {
	/** The meaning the card explains, as every format's first level names it. */
	readonly sense: string | null
	/** A draft by a fallback engine wins over an unsure answer. */
	readonly flag: CardFlag | null
}

/** The first-level cards of these notes; exported so a spec can assert the plan reads the index. */
// oxlint-disable-next-line typescript/explicit-module-boundary-types -- The Drizzle query type is long; cardFacts runs it.
export function selectFirstCards(db: Db, noteIds: readonly number[]) {
	return db
		.select({
			id: explanations.id,
			noteId: explanations.noteId,
			body: explanations.body,
			isUncertain: explanations.isUncertain,
			isDraft: explanations.isDraft,
			createdAt: explanations.createdAt,
		})
		.from(explanations)
		.where(and(inArray(explanations.noteId, [...noteIds]), eq(explanations.depth, 1)))
}

type FirstCard = ReturnType<ReturnType<typeof selectFirstCards>['all']>[number]

function isNewer(card: FirstCard, than: FirstCard) {
	const byTime = card.createdAt.getTime() - than.createdAt.getTime()

	return byTime === 0 ? card.id > than.id : byTime > 0
}

// Every format's first level opens with a `sense` (research/shared/formats/common.ts); blank is none.
const senseBody = v.object({ sense: v.pipe(v.string(), v.trim(), v.nonEmpty()) })

function flagOf({ isDraft, isUncertain }: FirstCard): CardFlag | null {
	if (isDraft) {
		return 'draft'
	}

	return isUncertain ? 'unsure' : null
}

/** The sense and flag of each note's newest first-level card, keyed by note id; no card, no entry. */
export function cardFacts(db: Db, noteIds: readonly number[]): Map<number, CardFacts> {
	const newest = new Map<number, FirstCard>()

	if (noteIds.length === 0) {
		return new Map()
	}

	for (const card of selectFirstCards(db, noteIds).all()) {
		const current = card.noteId === null ? undefined : newest.get(card.noteId)

		if (card.noteId !== null && (current === undefined || isNewer(card, current))) {
			newest.set(card.noteId, card)
		}
	}

	return new Map(
		[...newest].map(([noteId, card]) => {
			const parsed = v.safeParse(senseBody, card.body)
			const sense = parsed.success ? parsed.output.sense : null

			return [noteId, { sense, flag: flagOf(card) }]
		}),
	)
}
