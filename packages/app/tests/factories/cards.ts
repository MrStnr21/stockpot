// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

/*
 * Hand-written cards in every format and depth level, on public, generic terms. They show the shape an
 * engine must return; they are not the eval set (ENG-2), whose notes come from the owner.
 */
import { faker } from '@faker-js/faker'
import { Factory } from 'fishery'

import type { Card, Source } from '#/features/research/shared/formats'
import type { FormatId } from '#/lib/format-ids'
import type { Depth } from '#/server/engines/contract'

export const sourceFactory = Factory.define<Source>(() => ({
	title: faker.lorem.words(4),
	url: faker.internet.url(),
}))

export const vocabularyCardFactory = Factory.define<Card<'vocabulary', 1>>(() => ({
	sense: 'A lucky accident',
	aliases: ['serendipitous'],
	translation: 'a happy accident',
	partOfSpeech: 'noun',
	difficulty: 'medium',
	examples: [
		{
			text: 'Meeting her at the station was pure serendipity.',
			translation: 'Meeting her at the station was a lucky accident.',
		},
		{
			text: 'Many discoveries in science came about through serendipity.',
			translation: 'Many scientific discoveries happened by chance.',
		},
	],
	modelSentences: ['It was serendipity that we met.', 'By sheer serendipity, I found the book.'],
	mistake: 'Using it for any coincidence: it means a fortunate one.',
	sources: [],
	uncertain: false,
}))

export const vocabularyNuanceFactory = Factory.define<Card<'vocabulary', 2>>(() => ({
	nuance: 'Slightly literary; common in writing about discovery and in reflective speech.',
	synonyms: [{ word: 'chance', difference: 'Neutral; says nothing about the result being good.' }],
	collocations: ['pure serendipity', 'happy serendipity'],
	sources: [],
	uncertain: false,
}))

export const vocabularyPracticeFactory = Factory.define<Card<'vocabulary', 3>>(() => ({
	exercises: [
		{ prompt: 'Finding that café was pure ___.', answer: 'serendipity' },
		{ prompt: 'Make an adjective: a ___ meeting.', answer: 'serendipitous' },
		{ prompt: 'Is a missed train serendipity?', answer: 'No: serendipity is a lucky accident.' },
	],
	sources: [],
	uncertain: false,
}))

export const technologyCardFactory = Factory.define<Card<'technology', 1>>(() => ({
	sense: 'Embedded SQL database engine',
	aliases: ['SQLite3'],
	summary: 'A SQL database engine that runs inside the application and keeps data in one file.',
	analogy: 'Like localStorage with tables, transactions and SQL, but on the server.',
	relevance: null,
	sources: sourceFactory.buildList(2),
	uncertain: false,
}))

export const comparisonCardFactory = Factory.define<Card<'comparison', 1>>(() => ({
	sense: 'Container runtime',
	aliases: [],
	summary: 'A tool that builds and runs applications in isolated containers.',
	alternatives: [
		{
			name: 'Virtual machines',
			pros: 'Starts in seconds and shares the host kernel.',
			cons: 'Weaker isolation than a separate kernel.',
		},
	],
	worksWith: ['Linux', 'Kubernetes'],
	sources: sourceFactory.buildList(2),
	uncertain: false,
}))

export const conceptCardFactory = Factory.define<Card<'concept', 1>>(() => ({
	sense: 'Repeating an operation without changing the result',
	aliases: ['idempotent'],
	explanation: 'An operation is idempotent when doing it twice leaves things as doing it once.',
	analogy: 'Pressing a lift call button again does not call a second lift.',
	example: 'An HTTP PUT that sets a value can be retried safely.',
	seenIn: ['HTTP methods', 'job retries'],
	sources: [],
	uncertain: false,
}))

export const reportCardFactory = Factory.define<Card<'report', 1>>(() => ({
	sense: 'A recipe scaler',
	aliases: [],
	summary: 'A web app that rescales a recipe to any number of servings, for home cooks.',
	existing: [
		{ name: 'Recipe sites', note: 'Many scale servings, but only for their own recipes.' },
	],
	approaches: [
		{
			name: 'Rule-based parser',
			tradeoff: 'Predictable, but brittle on odd recipe formats.',
		},
	],
	risks: ['Units that do not scale linearly, such as baking times.'],
	firstSteps: ['Collect twenty recipes in different formats.'],
	gaps: [],
	sources: sourceFactory.buildList(3),
	uncertain: true,
}))

export const briefCardFactory = Factory.define<Card<'brief', 1>>(() => ({
	sense: 'Unit of typographic measure',
	aliases: [],
	explanation: 'An em is a length equal to the current font size, used for spacing in type.',
	sources: sourceFactory.buildList(1),
	uncertain: false,
}))

export const reportFeasibilityFactory = Factory.define<Card<'report', 2>>(() => ({
	recommendation: 'Start with rule-based parsing: it covers most recipe sites and needs no model.',
	architecture:
		'A parser turns a pasted recipe into quantities and units; a scaler multiplies them.',
	unknowns: ['How many recipes use free-form quantities such as "a handful"?'],
	effort: 'A few weekends for a first version; unit conversion takes most of it.',
	sources: sourceFactory.buildList(2),
	uncertain: true,
}))

export const reportPlanFactory = Factory.define<Card<'report', 3>>(() => ({
	prototype: 'A page that scales one pasted recipe, tried on twenty real ones.',
	milestones: [{ name: 'Parser', outcome: 'Quantities and units come out of most recipes.' }],
	tools: ['A unit conversion library'],
	sources: sourceFactory.buildList(1),
	uncertain: false,
}))

/** Level 2 of every format that shares it. */
export const deeperCardFactory = Factory.define<Card<'technology', 2>>(() => ({
	howItWorks: 'Pages of a B-tree are read from the file on demand and cached in memory.',
	tradeoffs: ['One writer at a time, so heavy concurrent writes queue up.'],
	sources: sourceFactory.buildList(1),
	uncertain: false,
}))

/** Level 3 of every format that shares it. */
export const handsOnCardFactory = Factory.define<Card<'technology', 3>>(() => ({
	steps: ['Create a database file.', 'Add a table and query it.'],
	example: 'CREATE TABLE note (id INTEGER PRIMARY KEY, text TEXT NOT NULL);',
	sources: sourceFactory.buildList(2),
	uncertain: false,
}))

/** The sample factory for each format and depth level. */
export const cardFactories = {
	vocabulary: {
		1: vocabularyCardFactory,
		2: vocabularyNuanceFactory,
		3: vocabularyPracticeFactory,
	},
	technology: { 1: technologyCardFactory, 2: deeperCardFactory, 3: handsOnCardFactory },
	comparison: { 1: comparisonCardFactory, 2: deeperCardFactory, 3: handsOnCardFactory },
	concept: { 1: conceptCardFactory, 2: deeperCardFactory, 3: handsOnCardFactory },
	report: { 1: reportCardFactory, 2: reportFeasibilityFactory, 3: reportPlanFactory },
	brief: { 1: briefCardFactory, 2: deeperCardFactory, 3: handsOnCardFactory },
} as const satisfies { [F in FormatId]: { [D in Depth]: Factory<Card<F, D>> } }
