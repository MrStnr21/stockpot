// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

/*
 * What `GET /api/notes/:id/card` answers: one note's opened card with every level, and where its
 * research stands. The server builds it; the browser parses every answer with `cardViewSchema`.
 * Dates are ISO 8601 strings, as JSON carries them.
 */
import { iconNames } from '@stockpot/ui/icon'
import * as v from 'valibot'

import { categoryColors } from '#/lib/category-look'
import { formatIds } from '#/lib/format-ids'
import type { NoteStatus } from '#/server/db/schema/notes'
import type { ResearchProgress } from '#/server/engines/contract'

import { blockHeadings, type Block } from './blocks'

/** Every note status, once. */
export const cardStatuses = [
	'new',
	'queued',
	'researching',
	'ready',
	'read',
	'archived',
	'failed',
] as const satisfies readonly NoteStatus[]

/* Fails to compile when the schema gains a status the card does not know. */
type AssertNone<T extends never> = T

export type UnknownCardStatus = AssertNone<Exclude<NoteStatus, (typeof cardStatuses)[number]>>

/** How a job ended when the engine failed, read from the error the job stored. */
export const failureKinds = ['timeout', 'invalid', 'auth', 'rate_limited', 'error'] as const

export type FailureKind = (typeof failureKinds)[number]

const id = v.pipe(v.number(), v.integer(), v.minValue(1))

const isoDate = v.pipe(v.string(), v.isoTimestamp())

const text = v.string()

const heading = v.picklist(blockHeadings)

function itemsOf<TEntries extends v.ObjectEntries>(entries: TEntries) {
	const item = v.object(entries)

	return v.array(item)
}

const strings = v.array(text)

const exampleItems = itemsOf({ text, translation: text })

const pairItems = itemsOf({ name: text, note: text })

const compareItems = itemsOf({ name: text, pros: text, cons: text })

const exerciseItems = itemsOf({ prompt: text, answer: text })

export const blockSchema = v.variant('kind', [
	v.object({ kind: v.literal('text'), heading, paragraphs: strings }),
	v.object({ kind: v.picklist(['note', 'code']), heading, text }),
	v.object({ kind: v.picklist(['list', 'steps', 'tags']), heading, items: strings }),
	v.object({ kind: v.literal('examples'), heading, items: exampleItems }),
	v.object({ kind: v.literal('pairs'), heading, items: pairItems }),
	v.object({ kind: v.literal('compare'), heading, items: compareItems }),
	v.object({ kind: v.literal('exercises'), heading, items: exerciseItems }),
]) satisfies v.GenericSchema<unknown, Block>

/** A page a card cites. Only HTTP(S) addresses pass, so a link never runs script. */
export const cardSourceSchema = v.object({
	title: v.string(),
	url: v.pipe(v.string(), v.url(), v.regex(/^https?:\/\//iu)),
})

export type CardSource = v.InferOutput<typeof cardSourceSchema>

const jobSchema = v.object({
	state: v.picklist(['queued', 'researching']),
	priority: v.picklist(['now', 'batch']),
	runAt: isoDate,
	queuedAt: isoDate,
	/** Active research jobs the worker takes before this one. */
	ahead: v.pipe(v.number(), v.integer(), v.minValue(0)),
})

export type JobView = v.InferOutput<typeof jobSchema>

const levelCardSchema = v.object({
	/** `null` when the stored body no longer fits its level's schema. */
	blocks: v.nullable(v.array(blockSchema)),
	sources: v.array(cardSourceSchema),
	isDraft: v.boolean(),
	isUncertain: v.boolean(),
	engine: v.string(),
	model: v.nullable(v.string()),
	language: v.string(),
	createdAt: isoDate,
	/** When a draft is written again: the run time of its level's redo job. */
	redoAt: v.nullable(isoDate),
	/** Google's Search Suggestions HTML for a grounded Gemini card, shown unmodified. */
	searchSuggestions: v.nullable(v.string()),
})

export type LevelCard = v.InferOutput<typeof levelCardSchema>

const levelSchema = v.object({
	depth: v.picklist([1, 2, 3]),
	job: v.nullable(jobSchema),
	card: v.nullable(levelCardSchema),
})

export type LevelView = v.InferOutput<typeof levelSchema>

const count = v.pipe(v.number(), v.integer(), v.minValue(0))

const progressSchema = v.object({
	step: v.picklist(['planning', 'searching', 'writing']),
	questions: count,
	searched: count,
	pages: count,
}) satisfies v.GenericSchema<unknown, ResearchProgress>

const noteSchema = v.object({
	id,
	text,
	context: v.nullable(text),
	status: v.picklist(cardStatuses),
	isPrivate: v.boolean(),
	isKept: v.boolean(),
})

const categorySchema = v.object({
	id,
	name: text,
	color: v.picklist(categoryColors),
	icon: v.picklist(iconNames),
})

const youglishLink = v.pipe(v.string(), v.url())

const factsSchema = v.object({
	partOfSpeech: text,
	difficulty: v.picklist(['easy', 'medium', 'hard']),
	youglish: v.nullable(youglishLink),
})

const failureSchema = v.object({ kind: v.picklist(failureKinds), attempts: count, at: isoDate })

const researchSchema = v.object({
	job: v.nullable(jobSchema),
	progress: v.nullable(progressSchema),
	failure: v.nullable(failureSchema),
})

const minutes = v.pipe(v.number(), v.integer(), v.minValue(1))

export const cardViewSchema = v.object({
	note: noteSchema,
	category: v.nullable(categorySchema),
	format: v.nullable(v.picklist(formatIds)),
	levelSet: v.picklist(['standard', 'word', 'report']),
	sense: v.nullable(text),
	facts: v.nullable(factsSchema),
	readingMinutes: v.nullable(minutes),
	levels: v.tuple([levelSchema, levelSchema, levelSchema]),
	research: researchSchema,
})

export type CardView = v.InferOutput<typeof cardViewSchema>

export type LevelSet = CardView['levelSet']
