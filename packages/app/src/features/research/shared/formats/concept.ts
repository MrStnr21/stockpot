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

const card = v.strictObject({
	...senseFields,
	explanation: text(1200, 'A plain explanation in two to four sentences.'),
	analogy: text(500, 'An analogy from everyday life or from software.'),
	example: text(600, 'One concrete example.'),
	seenIn: list(
		text(120, 'One place.'),
		{ min: 1, max: 5 },
		'Where the reader will meet it: fields, tools, situations.',
	),
	sources: sources(5),
	uncertain,
})

/** An idea from any field: a principle, a pattern, a law, a theory. */
export const concept = {
	task: 'explain',
	instructions:
		'Explain a concept so that the reader can recognise it and use it, without assuming they know the field it comes from.',
	levels: {
		1: { instructions: firstLevelInstructions, schema: card },
		2: deeperLevel,
		3: handsOnLevel,
	},
} as const satisfies Format
