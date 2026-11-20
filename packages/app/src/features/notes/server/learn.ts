// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { and, count, eq } from 'drizzle-orm'

import { normalizeTerm, seededAliases, termVariants } from '#/lib/normalize'
import type { Db } from '#/server/db/client'
import { aliases, terms } from '#/server/db/schema/notes'

import { findTermRows } from './history'

/* What a term learns from the first card written for it: other names for it, and the sense the card
 * explained. The research job calls both through src/instance.ts once the card is saved. */

const aliasLimit = 10

const seededSpellings = seededAliases.flat()

/** Take the write lock before checking ownership, so competing writes cannot claim the same alias. */
export function learnAliases(db: Db, termId: number, texts: readonly string[]): string[] {
	return db.transaction(
		(tx) => {
			const row = tx.select({ term: terms.term }).from(terms).where(eq(terms.id, termId)).get()

			if (row === undefined) {
				return []
			}

			const existing = tx
				.select({ count: count() })
				.from(aliases)
				.where(eq(aliases.termId, termId))
				.get()

			const remaining = aliasLimit - (existing?.count ?? 0)
			const reserved = new Set([...seededSpellings, ...termVariants(row.term)])
			const termWords = row.term.split(' ')
			const stored: string[] = []

			for (const text of texts) {
				if (stored.length >= remaining) {
					break
				}

				const alias = normalizeTerm(text)

				if (alias === null || alias.length < 3 || termWords.includes(alias)) {
					continue
				}

				if (termVariants(alias).some((variant) => reserved.has(variant))) {
					continue
				}

				if (findTermRows(tx, alias).some(({ row: match }) => match.id !== termId)) {
					continue
				}

				const inserted = tx
					.insert(aliases)
					.values({ alias, termId })
					.onConflictDoNothing()
					.returning({ alias: aliases.alias })
					.get()

				if (inserted !== undefined) {
					stored.push(inserted.alias)
				}
			}

			return stored
		},
		{ behavior: 'immediate' },
	)
}

/*
 * Records the sense a card explained as its term's meaning, so a later note in another sense can tell
 * the two apart. It only fills an empty meaning that no other row of the term holds: it never creates
 * a row or moves a note.
 */
export function learnSense(db: Db, termId: number, sense: string): void {
	const meaning = sense.trim()

	if (meaning === '') {
		return
	}

	db.transaction(
		(tx) => {
			const row = tx
				.select({ term: terms.term, meaning: terms.meaning })
				.from(terms)
				.where(eq(terms.id, termId))
				.get()

			if (row?.meaning !== '') {
				return
			}

			const holder = tx
				.select({ id: terms.id })
				.from(terms)
				.where(and(eq(terms.term, row.term), eq(terms.meaning, meaning)))
				.get()

			if (holder === undefined) {
				tx.update(terms).set({ meaning }).where(eq(terms.id, termId)).run()
			}
		},
		{ behavior: 'immediate' },
	)
}
