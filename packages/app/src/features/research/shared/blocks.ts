// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

/*
 * The blocks an opened card draws, whatever its format: the server maps a stored body to them, so the
 * browser needs no format knowledge (blocks-levels.ts holds the map). A heading is a key the client
 * turns into localized text. Text is trimmed, and blank text and empty lists are left out.
 */

/** Every heading a block may carry, in no particular order. */
export const blockHeadings = [
	'translation',
	'examples',
	'modelSentences',
	'mistake',
	'nuance',
	'synonyms',
	'collocations',
	'exercises',
	'whatItIs',
	'analogy',
	'relevance',
	'alternatives',
	'worksWith',
	'explanation',
	'example',
	'seenIn',
	'inShort',
	'existing',
	'approaches',
	'risks',
	'firstSteps',
	'gaps',
	'howItWorks',
	'tradeoffs',
	'steps',
	'recommendation',
	'architecture',
	'unknowns',
	'effort',
	'prototype',
	'milestones',
	'tools',
] as const

export type BlockHeading = (typeof blockHeadings)[number]

export interface ExampleItem {
	readonly text: string
	readonly translation: string
}

export interface PairItem {
	readonly name: string
	readonly note: string
}

export interface CompareItem {
	readonly name: string
	readonly pros: string
	readonly cons: string
}

export interface ExerciseItem {
	readonly prompt: string
	readonly answer: string
}

interface TextBlock {
	readonly kind: 'text'
	readonly heading: BlockHeading
	readonly paragraphs: string[]
}

/** A single text drawn as written: a highlighted note, or code or a worked example. */
interface PlainBlock<TKind extends 'note' | 'code'> {
	readonly kind: TKind
	readonly heading: BlockHeading
	readonly text: string
}

interface ItemsBlock<TKind extends string, TItem> {
	readonly kind: TKind
	readonly heading: BlockHeading
	readonly items: TItem[]
}

export type Block =
	| TextBlock
	| PlainBlock<'note'>
	| PlainBlock<'code'>
	| ItemsBlock<'list', string>
	| ItemsBlock<'steps', string>
	| ItemsBlock<'tags', string>
	| ItemsBlock<'examples', ExampleItem>
	| ItemsBlock<'pairs', PairItem>
	| ItemsBlock<'compare', CompareItem>
	| ItemsBlock<'exercises', ExerciseItem>

export type BlockKind = Block['kind']

/** Paragraphs are separated by a blank line. */
function paragraphsOf(value: string): string[] {
	return value.split(/\n\s*\n/u).flatMap((part) => {
		const paragraph = part.trim()

		return paragraph === '' ? [] : [paragraph]
	})
}

function filled(values: readonly string[]): string[] {
	return values.flatMap((value) => {
		const trimmed = value.trim()

		return trimmed === '' ? [] : [trimmed]
	})
}

export function textBlock(heading: BlockHeading, value: string | null): Block[] {
	const paragraphs = value === null ? [] : paragraphsOf(value)

	return paragraphs.length === 0 ? [] : [{ kind: 'text', heading, paragraphs }]
}

/** A single text drawn as it is written: a highlighted note, or code or a worked example. */
export function plainBlock(
	kind: 'note' | 'code',
	heading: BlockHeading,
	value: string | null,
): Block[] {
	// Code keeps its indentation; only the blank lines around it go.
	const text =
		kind === 'code' ? (value ?? '').replaceAll(/^\s*\n|\s+$/gu, '') : (value ?? '').trim()

	return text === '' ? [] : [{ kind, heading, text }]
}

export function itemsBlock(
	kind: 'list' | 'steps' | 'tags',
	heading: BlockHeading,
	values: readonly string[],
): Block[] {
	const items = filled(values)

	return items.length === 0 ? [] : [{ kind, heading, items }]
}

/** Drops an item with a blank field; the caller trims the fields. */
function keepFilled<TItem extends object>(items: TItem[]): TItem[] {
	return items.filter((item) => Object.values(item).every((value) => value !== ''))
}

export function examplesBlock(heading: BlockHeading, values: readonly ExampleItem[]): Block[] {
	const items = keepFilled(
		values.map(({ text, translation }) => ({ text: text.trim(), translation: translation.trim() })),
	)

	return items.length === 0 ? [] : [{ kind: 'examples', heading, items }]
}

export function pairsBlock(heading: BlockHeading, values: readonly PairItem[]): Block[] {
	const items = keepFilled(
		values.map(({ name, note }) => ({ name: name.trim(), note: note.trim() })),
	)

	return items.length === 0 ? [] : [{ kind: 'pairs', heading, items }]
}

export function compareBlock(heading: BlockHeading, values: readonly CompareItem[]): Block[] {
	const items = keepFilled(
		values.map(({ name, pros, cons }) => ({
			name: name.trim(),
			pros: pros.trim(),
			cons: cons.trim(),
		})),
	)

	return items.length === 0 ? [] : [{ kind: 'compare', heading, items }]
}

export function exercisesBlock(heading: BlockHeading, values: readonly ExerciseItem[]): Block[] {
	const items = keepFilled(
		values.map(({ prompt, answer }) => ({ prompt: prompt.trim(), answer: answer.trim() })),
	)

	return items.length === 0 ? [] : [{ kind: 'exercises', heading, items }]
}

function itemTexts(block: Exclude<Block, { kind: 'text' | 'note' | 'code' }>): string[] {
	if (block.kind === 'list' || block.kind === 'steps' || block.kind === 'tags') {
		return block.items
	}

	if (block.kind === 'examples') {
		return block.items.flatMap(({ text, translation }) => [text, translation])
	}

	if (block.kind === 'pairs') {
		return block.items.flatMap(({ name, note }) => [name, note])
	}

	if (block.kind === 'compare') {
		return block.items.flatMap(({ name, pros, cons }) => [name, pros, cons])
	}

	return block.items.flatMap(({ prompt, answer }) => [prompt, answer])
}

/** Every string a reader reads in the blocks, for the reading time. */
export function blockTexts(blocks: readonly Block[]): string[] {
	return blocks.flatMap((block) => {
		if (block.kind === 'text') {
			return block.paragraphs
		}

		if (block.kind === 'note' || block.kind === 'code') {
			return [block.text]
		}

		return itemTexts(block)
	})
}
