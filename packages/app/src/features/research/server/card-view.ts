// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

/*
 * One note's opened card, as `GET /api/notes/:id/card` and the card pages read it: the note and its
 * category, the newest card of each depth level, the jobs that write them, and an idea's progress.
 * Four reads on one handle, each through an index (a spec checks the plans).
 */
import { and, eq, isNull, sql } from 'drizzle-orm'
import * as v from 'valibot'

import type { Block } from '#/features/research/shared/blocks'
import {
	cardSourceSchema,
	type CardSource,
	type CardView,
	type JobView,
	type LevelCard,
	type LevelSet,
	type LevelView,
} from '#/features/research/shared/card-view'
import { readingMinutes } from '#/features/research/shared/reading-time'
import { youglishUrl } from '#/features/research/shared/youglish'
import { categoryLook } from '#/lib/category-look'
import { isFormatId, type FormatId } from '#/lib/format-ids'
import type { Db } from '#/server/db/client'
import { explanations } from '#/server/db/schema/explanations'
import { categories, notes } from '#/server/db/schema/notes'
import { log } from '#/server/log'

import { readCardBody } from './card-body'
import { noteJobs } from './card-jobs'
import type { ProgressBoard } from './ideas'

/** The note and its category; exported so a spec can assert the plan. */
// oxlint-disable-next-line typescript/explicit-module-boundary-types -- The Drizzle query type is long; readCardView runs it.
export function selectCardNote(db: Db, noteId: number) {
	return db
		.select({
			id: notes.id,
			text: notes.text,
			context: notes.context,
			status: notes.status,
			isPrivate: notes.isPrivate,
			keptAt: notes.keptAt,
			categoryId: categories.id,
			categoryName: categories.name,
			categoryColor: categories.color,
			categoryIcon: categories.icon,
			categoryFormat: categories.format,
		})
		.from(notes)
		.leftJoin(categories, eq(notes.categoryId, categories.id))
		.where(and(eq(notes.id, noteId), isNull(notes.deletedAt)))
}

/** Every card of the note, at any depth; exported so a spec can assert the plan. */
// oxlint-disable-next-line typescript/explicit-module-boundary-types -- The Drizzle query type is long; readCardView runs it.
export function selectNoteCards(db: Db, noteId: number) {
	return db
		.select({
			id: explanations.id,
			format: explanations.format,
			depth: explanations.depth,
			language: explanations.language,
			body: explanations.body,
			// As stored text: SQLite takes any text here (unlike `body`), and a row that is not JSON must not throw.
			sources: sql<string>`${explanations.sources}`,
			searchSuggestions: explanations.searchSuggestions,
			isUncertain: explanations.isUncertain,
			isDraft: explanations.isDraft,
			engine: explanations.engine,
			model: explanations.model,
			createdAt: explanations.createdAt,
		})
		.from(explanations)
		.where(eq(explanations.noteId, noteId))
}

type CardRow = ReturnType<ReturnType<typeof selectNoteCards>['all']>[number]

type Depth = LevelView['depth']

const depths = [1, 2, 3] as const satisfies readonly Depth[]

function isNewer(card: CardRow, than: CardRow) {
	const byTime = card.createdAt.getTime() - than.createdAt.getTime()

	return byTime === 0 ? card.id > than.id : byTime > 0
}

/** The newest card of each depth, by creation time and then id. */
function newestPerDepth(rows: readonly CardRow[]): Map<number, CardRow> {
	const newest = new Map<number, CardRow>()

	for (const row of rows) {
		const current = newest.get(row.depth)

		if (current === undefined || isNewer(row, current)) {
			newest.set(row.depth, row)
		}
	}

	return newest
}

// Logged once per card and process: a page that polls must not repeat it every few seconds.
const reported = new Set<number>()

function readBlocks(noteId: number, row: CardRow, depth: Depth): Block[] | null {
	const blocks = isFormatId(row.format) ? readCardBody(row.format, depth, row) : null

	if (blocks === null && !reported.has(row.id)) {
		reported.add(row.id)
		// Ids and the format only: the body is the owner's card text.
		log.warn('A stored card does not fit its format', { noteId, depth, format: row.format })
	}

	return blocks
}

// A source that no longer fits reads as `null` and is dropped, so an odd row never hides the rest.
const storedSource = v.fallback(v.nullable(cardSourceSchema), null)

const storedSources = v.fallback(v.array(storedSource), [])

function sourcesOf(row: CardRow): CardSource[] {
	try {
		return v.parse(storedSources, JSON.parse(row.sources)).filter((source) => source !== null)
	} catch {
		// Text that is not JSON at all reads as no sources, like any other odd value.
		return []
	}
}

function levelCard(row: CardRow, blocks: Block[] | null, job: JobView | null): LevelCard {
	return {
		blocks,
		sources: sourcesOf(row),
		isDraft: row.isDraft,
		isUncertain: row.isUncertain,
		engine: row.engine,
		model: row.model,
		language: row.language,
		createdAt: row.createdAt.toISOString(),
		redoAt: row.isDraft && job !== null ? job.runAt : null,
		searchSuggestions: row.searchSuggestions,
	}
}

const senseBody = v.object({ sense: v.pipe(v.string(), v.trim(), v.nonEmpty()) })

const wordFacts = v.object({
	partOfSpeech: v.string(),
	difficulty: v.picklist(['easy', 'medium', 'hard']),
})

function levelSetOf(format: FormatId | null): LevelSet {
	if (format === 'vocabulary') {
		return 'word'
	}

	return format === 'report' ? 'report' : 'standard'
}

type NoteRow = NonNullable<ReturnType<ReturnType<typeof selectCardNote>['get']>>

function categoryOf(note: NoteRow): CardView['category'] {
	if (note.categoryId === null) {
		return null
	}

	return {
		id: note.categoryId,
		name: note.categoryName ?? '',
		...categoryLook(note.categoryColor ?? '', note.categoryIcon ?? ''),
	}
}

/** The card's format: its first level's, so a category changed later keeps it; else the category's. */
function formatOf(note: NoteRow, first: CardRow | undefined): FormatId | null {
	if (first !== undefined && isFormatId(first.format)) {
		return first.format
	}

	return note.categoryFormat !== null && isFormatId(note.categoryFormat)
		? note.categoryFormat
		: null
}

/** What an English card's first level says about the word; a private note gets no YouGlish link. */
function factsOf(note: NoteRow, first: CardRow | undefined): CardView['facts'] {
	const parsed = first?.format === 'vocabulary' ? v.safeParse(wordFacts, first.body) : null

	if (parsed?.success !== true) {
		return null
	}

	return { ...parsed.output, youglish: note.isPrivate ? null : youglishUrl(note.text) }
}

/** A note's opened card at `now`; `null` for a note that is missing or deleted. */
export function readCardView(
	db: Db,
	board: Pick<ProgressBoard, 'get'>,
	{ noteId, now }: { noteId: number; now: Date },
): CardView | null {
	const note = selectCardNote(db, noteId).get()

	if (note === undefined) {
		return null
	}

	const cards = newestPerDepth(selectNoteCards(db, noteId).all())
	const jobs = noteJobs(db, { id: noteId, failed: note.status === 'failed' }, now)
	const first = cards.get(1)
	const format = formatOf(note, first)

	const levels = depths.map((depth): LevelView => {
		const row = cards.get(depth)
		const job = jobs.levels[depth - 1]
		const card = row === undefined ? null : levelCard(row, readBlocks(noteId, row, depth), job)

		return { depth, job, card }
	})

	const [one, two, three] = levels
	const firstBlocks = one.card?.blocks ?? null
	const sense = first === undefined ? null : v.safeParse(senseBody, first.body)

	return {
		note: {
			id: note.id,
			text: note.text,
			context: note.context,
			status: note.status,
			isPrivate: note.isPrivate,
			isKept: note.keptAt !== null,
		},
		category: categoryOf(note),
		format,
		levelSet: levelSetOf(format),
		sense: sense?.success === true ? sense.output.sense : null,
		// Only a body that fits its level has facts to show, as it has blocks.
		facts: firstBlocks === null ? null : factsOf(note, first),
		readingMinutes: firstBlocks === null ? null : readingMinutes(firstBlocks),
		levels: [one, two, three],
		research: { job: jobs.levels[0], progress: board.get(noteId), failure: jobs.failure },
	}
}
