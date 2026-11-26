// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

/*
 * Which blocks each format's level becomes, in the order the Cards boards draw them. Only types come
 * from the formats: their module derives JSON Schemas at runtime, which the browser must not load.
 */
import type { FormatId } from '#/lib/format-ids'
import type { Depth } from '#/server/engines/contract'

import {
	compareBlock,
	examplesBlock,
	exercisesBlock,
	itemsBlock,
	pairsBlock,
	plainBlock,
	textBlock,
	type Block,
} from './blocks'
import type { Card } from './formats'

/**
 * A stored card body: the engine's answer without its sources and its `uncertain` flag. It spreads
 * over unions, so `CardBody<FormatId, Depth>` is any one body rather than their common fields.
 */
export type CardBody<F extends FormatId, D extends Depth> = F extends FormatId
	? D extends Depth
		? Omit<Card<F, D>, 'sources' | 'uncertain'>
		: never
	: never

type LevelBlocks = { [F in FormatId]: { [D in Depth]: (body: CardBody<F, D>) => Block[] } }

function deeper(body: CardBody<'technology', 2>): Block[] {
	return [
		...textBlock('howItWorks', body.howItWorks),
		...itemsBlock('list', 'tradeoffs', body.tradeoffs),
	]
}

function handsOn(body: CardBody<'technology', 3>): Block[] {
	return [
		...itemsBlock('steps', 'steps', body.steps),
		...plainBlock('code', 'example', body.example),
	]
}

const levelBlocks: LevelBlocks = {
	vocabulary: {
		1: (body) => [
			...textBlock('translation', body.translation),
			...examplesBlock('examples', body.examples),
			...itemsBlock('list', 'modelSentences', body.modelSentences),
			...plainBlock('note', 'mistake', body.mistake),
		],
		2: (body) => [
			...textBlock('nuance', body.nuance),
			...pairsBlock(
				'synonyms',
				body.synonyms.map(({ word, difference }) => ({ name: word, note: difference })),
			),
			...itemsBlock('tags', 'collocations', body.collocations),
		],
		3: (body) => exercisesBlock('exercises', body.exercises),
	},
	technology: {
		1: (body) => [
			...textBlock('whatItIs', body.summary),
			...textBlock('analogy', body.analogy),
			...textBlock('relevance', body.relevance),
		],
		2: deeper,
		3: handsOn,
	},
	comparison: {
		1: (body) => [
			...textBlock('whatItIs', body.summary),
			...compareBlock('alternatives', body.alternatives),
			...itemsBlock('tags', 'worksWith', body.worksWith),
		],
		2: deeper,
		3: handsOn,
	},
	concept: {
		1: (body) => [
			...textBlock('explanation', body.explanation),
			...textBlock('analogy', body.analogy),
			...textBlock('example', body.example),
			...itemsBlock('list', 'seenIn', body.seenIn),
		],
		2: deeper,
		3: handsOn,
	},
	report: {
		1: (body) => [
			...textBlock('inShort', body.summary),
			...pairsBlock('existing', body.existing),
			...pairsBlock(
				'approaches',
				body.approaches.map(({ name, tradeoff }) => ({ name, note: tradeoff })),
			),
			...itemsBlock('list', 'risks', body.risks),
			...itemsBlock('steps', 'firstSteps', body.firstSteps),
			...itemsBlock('list', 'gaps', body.gaps),
		],
		2: (body) => [
			...textBlock('recommendation', body.recommendation),
			...textBlock('architecture', body.architecture),
			...itemsBlock('list', 'unknowns', body.unknowns),
			...textBlock('effort', body.effort),
		],
		3: (body) => [
			...textBlock('prototype', body.prototype),
			...pairsBlock(
				'milestones',
				body.milestones.map(({ name, outcome }) => ({ name, note: outcome })),
			),
			...itemsBlock('tags', 'tools', body.tools),
		],
	},
	brief: {
		1: (body) => textBlock('explanation', body.explanation),
		2: deeper,
		3: handsOn,
	},
}

/** The blocks of a body that passed its level's schema. */
export function cardBlocks<F extends FormatId, D extends Depth>(
	format: F,
	depth: D,
	body: CardBody<F, D>,
): Block[] {
	// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- SAFETY: levelBlocks maps every format and depth to the function for exactly that body.
	const blocksOf = levelBlocks[format][depth] as (body: CardBody<F, D>) => Block[]

	return blocksOf(body)
}
