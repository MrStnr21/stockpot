// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

/*
 * A research report on an idea the reader might build, written by the long-running `research` task.
 * Its levels go from the landscape (level 1) to the feasibility of one approach (2) to a build plan
 * (3), instead of the shared levels, which explain how a thing works.
 */
import * as v from 'valibot'

import { list, senseFields, sources, text, uncertain, type Format } from './common'

const existingSolution = v.strictObject({
	name: text(80, 'The product, project or approach.'),
	note: text(300, 'What it does and how it differs from the idea.'),
})

const landscape = v.strictObject({
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

const feasibility = v.strictObject({
	recommendation: text(800, 'The approach you would take and why, building on the first report.'),
	architecture: text(
		2000,
		'How that approach would be built: the main parts and how they fit together.',
	),
	unknowns: list(
		text(300, 'One open question.'),
		{ min: 1, max: 6 },
		'What to find out before building, most important first.',
	),
	effort: text(
		500,
		'A rough estimate of the work for a first usable version, and what dominates it.',
	),
	sources: sources(10),
	uncertain,
})

const milestone = v.strictObject({
	name: text(80, 'The milestone.'),
	outcome: text(300, 'What works when it is done.'),
})

const buildPlan = v.strictObject({
	prototype: text(800, 'The smallest version that tests whether the idea works, and how to tell.'),
	milestones: list(
		milestone,
		{ min: 1, max: 6 },
		'Milestones from the prototype to a first usable version, in order.',
	),
	tools: list(
		text(80, 'One tool, library or service.'),
		{ min: 0, max: 8 },
		'Tools, libraries and services to build it with.',
	),
	sources: sources(10),
	uncertain,
})

export const report = {
	task: 'research',
	instructions:
		'Research an idea the reader is considering building. Search widely, read what you find and cite it; take the time the research needs.',
	levels: {
		1: {
			instructions:
				'This is the first report on the idea: what exists already, how it could be built, what could go wrong and where to start. Make it thorough and organised, with every claim backed by a source you found.',
			schema: landscape,
		},
		2: {
			instructions:
				'This is the second report on the idea. The reader has read the first one, given below: do not repeat it. Pick the most promising approach and test its feasibility: how it would be built, what is still unknown and how much work it is.',
			schema: feasibility,
		},
		3: {
			instructions:
				'This is the third report on the idea. The reader has read the earlier ones, given below: do not repeat them. Turn the chosen approach into a build plan: a prototype first, then milestones and the tools to use.',
			schema: buildPlan,
		},
	},
} as const satisfies Format
