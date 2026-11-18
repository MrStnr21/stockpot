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

const existingSolution = v.strictObject({
	name: text(80, 'The product, project or approach.'),
	note: text(300, 'What it does and how it differs from the idea.'),
})

const card = v.strictObject({
	...senseFields,
	summary: text(500, 'The idea restated in one or two sentences: what it is and for whom.'),
	existing: list(
		existingSolution,
		{ min: 0, max: 8 },
		'Solutions and competitors that already exist; empty when you found none.',
	),
	approaches: list(
		text(400, 'One approach and its main trade-off.'),
		{ min: 1, max: 5 },
		'Ways to build it, each with its main trade-off.',
	),
	risks: list(
		text(300, 'One risk.'),
		{ min: 1, max: 5 },
		'What could make it fail: technical, legal, market.',
	),
	firstSteps: list(text(300, 'One step.'), { min: 1, max: 5 }, 'Concrete first steps, in order.'),
	sources: sources(10),
	uncertain,
})

/** A research report on an idea the reader might build, written by the long-running `research` task. */
export const report = {
	task: 'research',
	instructions:
		'Research an idea the reader is considering building: what exists already, how it could be built, what could go wrong and where to start. Search widely and cite what you find.',
	levels: {
		1: { instructions: firstLevelInstructions, schema: card },
		2: deeperLevel,
		3: handsOnLevel,
	},
} as const satisfies Format
