// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

/*
 * Card views as `GET /api/notes/:id/card` answers them, for the card's client logic. A written level
 * carries the blocks the server reads from a body that passed its level's real schema.
 */
import { faker } from '@faker-js/faker'
import { storedBody } from '#tests/factories/card-bodies'

import { readCardBody } from '#/features/research/server/card-body'
import type { CardView, JobView, LevelCard, LevelView } from '#/features/research/shared/card-view'
import type { FormatId } from '#/lib/format-ids'

type Depth = LevelView['depth']

export const viewTime = '2026-11-19T06:31:00.000Z'

/** A level written by Gemini, with its sample blocks; `values` replace any field. */
export function levelCard(
	format: FormatId,
	depth: Depth,
	values: Partial<LevelCard> = {},
): LevelCard {
	return {
		blocks: readCardBody(format, depth, { body: storedBody(format, depth) }),
		sources: [{ title: faker.lorem.words(3), url: faker.internet.url() }],
		isDraft: false,
		isUncertain: false,
		engine: 'gemini',
		model: null,
		language: 'ru',
		createdAt: viewTime,
		redoAt: null,
		searchSuggestions: null,
		...values,
	}
}

/** A job: queued for tonight's batch, with nothing ahead of it; `values` replace any field. */
export function jobView(values: Partial<JobView> = {}): JobView {
	return {
		state: 'queued',
		priority: 'batch',
		runAt: viewTime,
		queuedAt: viewTime,
		ahead: 0,
		...values,
	}
}

export interface CardViewChanges extends Partial<Omit<CardView, 'note' | 'research'>> {
	readonly note?: Partial<CardView['note']>
	readonly research?: Partial<CardView['research']>
}

function levelSetOf(format: FormatId | null): CardView['levelSet'] {
	if (format === 'vocabulary') {
		return 'word'
	}

	return format === 'report' ? 'report' : 'standard'
}

/** A new note in `format` with no card yet; `changes` replace any part. */
export function cardView(format: FormatId | null, changes: CardViewChanges = {}): CardView {
	const { note, research, ...rest } = changes

	return {
		category: { id: 1, name: faker.word.noun(), color: 'tech', icon: 'tech' },
		format,
		levelSet: levelSetOf(format),
		sense: null,
		facts: null,
		readingMinutes: null,
		levels: [
			{ depth: 1, job: null, card: null },
			{ depth: 2, job: null, card: null },
			{ depth: 3, job: null, card: null },
		],
		...rest,
		note: {
			id: faker.number.int({ min: 1, max: 100_000 }),
			text: faker.word.noun(),
			context: null,
			status: 'new',
			isPrivate: false,
			isKept: false,
			...note,
		},
		research: { job: null, progress: null, failure: null, ...research },
	}
}

/** A level's card and job, as `levels` takes them. */
export type LevelParts = Partial<Pick<LevelView, 'card' | 'job'>>

/** The three levels, each with the card and job given for it. */
export function levels(...given: LevelParts[]): CardView['levels'] {
	const [one = {}, two = {}, three = {}] = given

	return [
		{ depth: 1, job: null, card: null, ...one },
		{ depth: 2, job: null, card: null, ...two },
		{ depth: 3, job: null, card: null, ...three },
	]
}
