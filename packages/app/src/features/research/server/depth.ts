// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

/*
 * The deeper job: writes level 2 or 3 of a note's card as a card of its own, built on the levels
 * below it. It has its own job kind, so the nightly batch and research now, which look for notes
 * that wait for a first card, never see it.
 */
import { and, eq, isNull, lte, ne } from 'drizzle-orm'
import * as v from 'valibot'

import {
	cardFormat,
	earlierCard,
	formats,
	type CardSchema,
} from '#/features/research/shared/formats'
import { isFormatId, type FormatId } from '#/lib/format-ids'
import type { Db } from '#/server/db/client'
import { explanations } from '#/server/db/schema/explanations'
import { categories, notes, terms } from '#/server/db/schema/notes'
import { EngineError, redactPrivate, type JsonValue } from '#/server/engines/contract'
import type { JobContext, JobDefinition } from '#/server/jobs/types'
import { log } from '#/server/log'

import { noteCategoryId, type Transaction } from './assemble'
import { saveLevel } from './depth-save'
import {
	callRouter,
	notifyReady,
	publicEngineError,
	runAtAfterReset,
	type CardCall,
} from './engine-call'
import { checkSources } from './links'
import type { ResearchDependencies } from './pipeline'

export interface DeeperPayload {
	noteId: number
	/** The level to write; the one below it must already exist. */
	depth: 2 | 3
	/* Set when the owner asked for it at once: the job runs at the `now` priority, keeps it across a
	 * wait for an engine's reset and notifies when its level is saved. */
	now?: true
}

/** The research job's dependencies without `learn`: a deeper card names no sense or aliases to learn. */
export interface DeeperDependencies extends Omit<ResearchDependencies, 'learn' | 'later'> {
	/** Queues the same job again at `runAt`: a draft's redo, or a run after an engine's reset. */
	readonly later: (payload: DeeperPayload, runAt: Date) => void
}

type Schema = CardSchema<FormatId, 2 | 3>

export interface DeeperTask extends CardCall<Schema> {
	readonly noteId: number
	readonly depth: 2 | 3
}

// Stored cards are JSON, so any value but `undefined` is one.
const storedBody = v.record(
	v.string(),
	v.custom<JsonValue>((value) => value !== undefined),
)

const maxAttempts = 3

function readLevels(tx: Transaction, noteId: number, depth: number) {
	return tx
		.select()
		.from(explanations)
		.where(and(eq(explanations.noteId, noteId), lte(explanations.depth, depth)))
		.orderBy(explanations.depth, explanations.id)
		.all()
}

function earlierCards(levels: ReturnType<typeof readLevels>, depth: number): JsonValue[] | null {
	// Ordered by depth then id, so a later row at the same depth is the newer one.
	const byDepth = new Map(levels.filter((row) => row.depth < depth).map((row) => [row.depth, row]))
	const cards: JsonValue[] = []

	for (let level = 1; level < depth; level += 1) {
		const row = byDepth.get(level)

		if (row === undefined) {
			return null
		}

		const body = v.safeParse(storedBody, row.body)

		if (!body.success) {
			// Without the issues: they quote the stored value.
			throw new Error('A stored card has no object body')
		}

		const sources = row.sources.map(({ title, url }) => ({ title, url }))

		const card = { ...body.output, sources }

		cards.push(earlierCard(card))
	}

	return cards
}

/**
 * Reads what the engine needs for level `depth` of a note, or returns `null` when there is nothing
 * to do: the note is gone, deleted or archived, a level below is missing, the level is already
 * written, or the note is private and has no term to send. Nothing is written.
 */
export function assembleLevel(
	db: Db,
	{ noteId, depth, language }: { noteId: number; depth: 2 | 3; language: () => string },
): DeeperTask | null {
	return db.transaction(
		(tx) => {
			const subject = tx
				.select({ note: notes, term: terms.term, category: categories })
				.from(notes)
				.leftJoin(terms, eq(terms.id, notes.termId))
				.leftJoin(categories, eq(categories.id, noteCategoryId(tx)))
				.where(and(eq(notes.id, noteId), isNull(notes.deletedAt), ne(notes.status, 'archived')))
				.limit(1)
				.get()

			if (subject === undefined) {
				return null
			}

			const { note, term, category } = subject

			if (category === null) {
				return null
			}

			const levels = readLevels(tx, noteId, depth)
			const previous = earlierCards(levels, depth)
			const first = levels.findLast((row) => row.depth === 1)

			if (previous === null || first === undefined) {
				return null
			}

			// A draft is replaced by its redo, a finished level is kept.
			if (levels.some((row) => row.depth === depth && !row.isDraft)) {
				return null
			}

			if (note.isPrivate && term === null) {
				log.info('Deeper level skipped: a private note without a term', { noteId, depth })

				return null
			}

			// The first card's format, not the category's: the earlier cards are in it.
			if (!isFormatId(first.format)) {
				throw new Error('Unknown research card format')
			}

			const cardTerm = term ?? note.text

			const input = redactPrivate({
				task: formats[first.format].task,
				output: cardFormat(first.format, depth),
				note: {
					term: cardTerm,
					text: note.text === cardTerm ? null : note.text,
					context: note.context,
					url: note.url,
					isPrivate: note.isPrivate,
				},
				category: { name: category.name, instructions: category.instructions.trim() || null },
				depth,
				language: language(),
				previous,
			})

			return { noteId, depth, categoryId: category.id, input }
		},
		{ behavior: 'immediate' },
	)
}

/*
 * Settles the engine failures a retry cannot help with, and returns whether it did. The note's
 * status is not touched: it describes the first card.
 */
function settleEngineFailure(
	deps: DeeperDependencies,
	payload: DeeperPayload,
	error: EngineError,
): boolean {
	const { failure } = error

	if (failure.kind === 'rate_limited') {
		// The same payload, so a `now` job keeps its priority.
		deps.later(payload, runAtAfterReset(failure.resetsAt, deps.now?.() ?? new Date()))

		return true
	}

	if (failure.kind === 'auth') {
		log.warn('Deeper level failed: the engine rejected its key', {
			noteId: payload.noteId,
			depth: payload.depth,
			kind: failure.kind,
		})

		return true
	}

	return false
}

async function deepen(
	deps: DeeperDependencies,
	payload: DeeperPayload,
	context: JobContext,
): Promise<void> {
	const { db, language } = deps
	const { noteId, depth } = payload

	try {
		const task = assembleLevel(db, { noteId, depth, language })

		if (task === null) {
			return
		}

		const result = await callRouter(deps.router, task, context)
		const card = await checkSources(result.output, { open: deps.openLink, signal: context.signal })
		context.signal.throwIfAborted()

		const kept = card.sources.length
		const dropped = result.output.sources.length - kept

		if (dropped > 0) {
			log.info('Checked card links', { noteId, depth, kept, dropped })
		}

		const saved = saveLevel(db, task, { ...result, output: card })

		if (saved === null) {
			return
		}

		if (result.draft) {
			// Background work: without the flag, so the finished card does not notify a second time.
			deps.later({ noteId, depth }, runAtAfterReset(result.redoAt, deps.now?.() ?? new Date()))
		}

		// Last, so nothing after it can throw and make a retry notify again.
		if (payload.now === true) {
			notifyReady(deps.notify, { noteId })
		}
	} catch (error) {
		if (!(error instanceof EngineError && settleEngineFailure(deps, payload, error))) {
			throw error
		}
	}
}

/** The `deeper` job: writes level 2 or 3 of a note's card. */
export function createDeeperJob(deps: DeeperDependencies): JobDefinition<DeeperPayload> {
	return {
		kind: 'deeper',
		maxAttempts,
		// Just above the engine's own 15-minute research timeout, so that one fires first.
		timeout: 16 * 60_000,
		run: async (payload, context) => {
			try {
				await deepen(deps, payload, context)
			} catch (error) {
				if (error instanceof EngineError) {
					throw publicEngineError(error)
				}

				throw error
			}
		},
	}
}
