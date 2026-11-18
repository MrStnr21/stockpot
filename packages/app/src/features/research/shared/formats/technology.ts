// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import * as v from 'valibot'

import {
	deeperLevel,
	firstLevelInstructions,
	handsOnLevel,
	senseFields,
	sources,
	text,
	textOrNull,
	uncertain,
	type Format,
} from './common'

/** A technology or technical term: a library, a protocol, a tool, a piece of jargon. */
export const technology = {
	task: 'explain',
	instructions:
		'Explain a technology or technical term to a software developer who met it in passing and wants to know whether it matters to them.',
	levels: {
		1: {
			instructions: firstLevelInstructions,
			schema: v.strictObject({
				...senseFields,
				summary: text(280, 'What it is, in one sentence.'),
				analogy: text(
					500,
					'An analogy to something a software developer already knows. The category instructions may name the stack to draw on.',
				),
				relevance: textOrNull(
					500,
					'Why it matters to the reader, judged from where they saw it (the context); null when there is no context.',
				),
				sources: sources(5, 'Pages to dig deeper: the official site and documentation first.'),
				uncertain,
			}),
		},
		2: deeperLevel,
		3: handsOnLevel,
	},
} as const satisfies Format
