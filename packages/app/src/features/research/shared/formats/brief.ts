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
	uncertain,
	type Format,
} from './common'

/** Anything that fits no other format: a short explanation with links. */
export const brief = {
	task: 'explain',
	instructions: 'Explain the note briefly, with links to read more.',
	levels: {
		1: {
			instructions: firstLevelInstructions,
			schema: v.strictObject({
				...senseFields,
				explanation: text(800, 'A short explanation in two or three sentences.'),
				sources: sources(5),
				uncertain,
			}),
		},
		2: deeperLevel,
		3: handsOnLevel,
	},
} as const satisfies Format
