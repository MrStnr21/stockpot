// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { and, desc, eq, isNull, ne, sql } from 'drizzle-orm'

import { cardFormat, formats, type CardSchema } from '#/features/research/shared/formats'
import { isFormatId, type FormatId } from '#/lib/format-ids'
import type { Db } from '#/server/db/client'
import { explanations } from '#/server/db/schema/explanations'
import { categories, notes, terms } from '#/server/db/schema/notes'
import { redactPrivate, type CardInput } from '#/server/engines/contract'

type Transaction = Parameters<Parameters<Db['transaction']>[0]>[0]

type Schema = CardSchema<FormatId, 1>

export interface ResearchTask {
	readonly noteId: number
	readonly categoryId: number
	readonly input: CardInput<'explain', Schema> | CardInput<'research', Schema>
}

function readSubject(tx: Transaction, noteId: number) {
	const fallback = tx
		.select({ id: categories.id })
		.from(categories)
		.orderBy(desc(eq(categories.format, 'brief')), categories.position, categories.id)
		.limit(1)

	const categoryId = sql`coalesce(${notes.categoryId}, ${terms.categoryId}, ${fallback})`

	return tx
		.select({
			note: notes,
			term: terms.term,
			category: categories,
			cardId: explanations.id,
		})
		.from(notes)
		.leftJoin(terms, eq(terms.id, notes.termId))
		.leftJoin(categories, eq(categories.id, categoryId))
		.leftJoin(
			explanations,
			and(
				eq(explanations.noteId, notes.id),
				eq(explanations.depth, 1),
				eq(explanations.isDraft, false),
			),
		)
		.where(and(eq(notes.id, noteId), isNull(notes.deletedAt), ne(notes.status, 'archived')))
		.limit(1)
		.get()
}

export function assemble(
	db: Db,
	{ noteId, language }: { noteId: number; language: () => string },
): ResearchTask | null {
	return db.transaction(
		(tx) => {
			const subject = readSubject(tx, noteId)

			if (subject === undefined) {
				return null
			}

			const { note, term, category, cardId } = subject
			const byId = eq(notes.id, noteId)

			if (cardId !== null) {
				if (note.status !== 'read' && note.status !== 'ready') {
					tx.update(notes).set({ status: 'ready' }).where(byId).run()
				}

				return null
			}

			// A private note without a linked term has nothing it can send to an engine.
			if (category === null || (note.isPrivate && term === null)) {
				tx.update(notes).set({ status: 'failed' }).where(byId).run()

				return null
			}

			if (!isFormatId(category.format)) {
				throw new Error('Unknown research card format')
			}

			if (note.status === 'new' || note.status === 'queued' || note.status === 'failed') {
				tx.update(notes).set({ status: 'researching' }).where(byId).run()
			}

			const cardTerm = term ?? note.text

			const input = redactPrivate({
				task: formats[category.format].task,
				output: cardFormat(category.format, 1),
				note: {
					term: cardTerm,
					text: note.text === cardTerm ? null : note.text,
					context: note.context,
					url: note.url,
					isPrivate: note.isPrivate,
				},
				category: { name: category.name, instructions: category.instructions.trim() || null },
				depth: 1,
				language: language(),
				previous: [],
			})

			return { noteId, categoryId: category.id, input }
		},
		{ behavior: 'immediate' },
	)
}
