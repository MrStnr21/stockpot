// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { describe, expect, it } from 'bun:test'
import { storedBody, type StoredBodyJson } from '#tests/factories/card-bodies'

import type { Block } from '#/features/research/shared/blocks'
import { depths } from '#/features/research/shared/formats'
import { formatIds, type FormatId } from '#/lib/format-ids'
import type { Depth } from '#/server/engines/contract'

import { readCardBody } from './card-body'

const deeper = ['text howItWorks', 'list tradeoffs']

const handsOn = ['steps steps', 'code example']

/* Each format and depth with the blocks its sample card becomes, in the order the Cards boards draw
 * them. A sample's `null` fields and empty lists are left out (technology relevance, report gaps). */
const expected: Record<FormatId, Record<Depth, string[]>> = {
	vocabulary: {
		1: ['text translation', 'examples examples', 'list modelSentences', 'note mistake'],
		2: ['text nuance', 'pairs synonyms', 'tags collocations'],
		3: ['exercises exercises'],
	},
	technology: { 1: ['text whatItIs', 'text analogy'], 2: deeper, 3: handsOn },
	comparison: {
		1: ['text whatItIs', 'compare alternatives', 'tags worksWith'],
		2: deeper,
		3: handsOn,
	},
	concept: {
		1: ['text explanation', 'text analogy', 'text example', 'list seenIn'],
		2: deeper,
		3: handsOn,
	},
	report: {
		1: ['text inShort', 'pairs existing', 'pairs approaches', 'list risks', 'steps firstSteps'],
		2: ['text recommendation', 'text architecture', 'list unknowns', 'text effort'],
		3: ['text prototype', 'pairs milestones', 'tags tools'],
	},
	brief: { 1: ['text explanation'], 2: deeper, 3: handsOn },
}

const cases = formatIds.flatMap((format) =>
	depths.map((depth) => [format, depth, expected[format][depth]] as const),
)

function read(format: FormatId, depth: Depth, changes: StoredBodyJson = {}) {
	return readCardBody(format, depth, { body: storedBody(format, depth, changes) })
}

function outline(blocks: readonly Block[] | null) {
	return blocks?.map(({ kind, heading }) => `${kind} ${heading}`) ?? null
}

describe('readCardBody', () => {
	it.each(cases)(
		'maps a %s body at depth %d to its blocks in board order',
		(format, depth, blocks) => {
			expect(outline(read(format, depth))).toEqual(blocks)
		},
	)

	it('keeps an optional field in its place once it is filled', () => {
		expect(outline(read('technology', 1, { relevance: 'It runs your tests.' }))).toEqual([
			'text whatItIs',
			'text analogy',
			'text relevance',
		])
		expect(outline(read('report', 1, { gaps: ['Who pays for it?'] }))?.at(-1)).toBe('list gaps')
	})

	it('names the second field of each pair as its note', () => {
		const synonyms = read('vocabulary', 2, {
			synonyms: [{ word: 'fluke', difference: 'Luck, not insight.' }],
		})

		const approaches = read('report', 1, {
			approaches: [{ name: 'A browser extension', tradeoff: 'Easy to ship, one browser.' }],
		})

		const milestones = read('report', 3, {
			milestones: [{ name: 'Parser', outcome: 'Units come out right.' }],
		})

		expect([synonyms?.[1], approaches?.[2], milestones?.[1]]).toEqual([
			{
				kind: 'pairs',
				heading: 'synonyms',
				items: [{ name: 'fluke', note: 'Luck, not insight.' }],
			},
			{
				kind: 'pairs',
				heading: 'approaches',
				items: [{ name: 'A browser extension', note: 'Easy to ship, one browser.' }],
			},
			{
				kind: 'pairs',
				heading: 'milestones',
				items: [{ name: 'Parser', note: 'Units come out right.' }],
			},
		])
	})

	it('splits text on blank lines and trims it', () => {
		const blocks = read('technology', 2, { howItWorks: '  First part.\n\nSecond part.\n  \n' })

		expect(blocks?.[0]).toEqual({
			kind: 'text',
			heading: 'howItWorks',
			paragraphs: ['First part.', 'Second part.'],
		})
	})

	it.each([
		['a partial body', { sense: 'Embedded database', summary: 'A database in a file.' }],
		['a body with a field the level does not have', { ...storedBody('technology', 1), extra: 'x' }],
		['a body with a field of the wrong type', { ...storedBody('technology', 1), summary: 42 }],
		['a body that kept its sources', { ...storedBody('technology', 1), sources: [] }],
		['a list', ['not', 'a', 'card']],
		['null', null],
	])('reads %s as null without throwing', (_name, body) => {
		expect(readCardBody('technology', 1, { body })).toBeNull()
	})
})
