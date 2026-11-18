// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import * as v from 'valibot'

import {
	deeperLevel,
	firstLevelInstructions,
	handsOnLevel,
	list,
	senseFields,
	sources,
	text,
	uncertain,
	type Format,
} from './common'

const alternative = v.strictObject({
	name: text(80, 'The alternative.'),
	pros: text(300, 'Where the subject is better than this alternative.'),
	cons: text(300, 'Where the subject is worse than this alternative.'),
})

const card = v.strictObject({
	...senseFields,
	summary: text(280, 'What it is, in one sentence.'),
	alternatives: list(
		alternative,
		{ min: 1, max: 4 },
		'The closest alternatives, compared with the subject: a table with one row each.',
	),
	worksWith: list(
		text(80, 'One tool, platform or format.'),
		{ min: 0, max: 8 },
		'Tools, platforms and formats it works with.',
	),
	sources: sources(
		5,
		'Two or three primary sources to read: the announcement, the paper, the documentation.',
	),
	uncertain,
})

/** A product or model in a crowded field, explained by how it compares with its alternatives. */
export const comparison = {
	task: 'explain',
	instructions:
		'Explain a product, model or tool in a fast-moving field by placing it among its alternatives. Prefer facts from primary sources over reviews.',
	levels: {
		1: { instructions: firstLevelInstructions, schema: card },
		2: deeperLevel,
		3: handsOnLevel,
	},
} as const satisfies Format
