// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

/*
 * The opened card's words and controls as its components draw them: everything the markup shows
 * that is not a field of the view, worked out here so the components only bind it.
 */
import type { CardMessages } from '#/lib/i18n/card-en'

import type { BlockHeading } from '../shared/blocks'
import type { CardSource, CardView } from '../shared/card-view'
import type { CardAction } from './card-actions'
import type { CardLayout, LevelTab, WaitButton, WaitPanel } from './card-panel'
import {
	bannerTexts,
	counted,
	levelName,
	metaLine,
	stepText,
	waitTexts,
	type BannerTexts,
	type TextContext,
	type WaitTexts,
} from './card-text'

export interface ScreenContext extends TextContext {
	readonly strings: CardMessages
}

export interface LevelControl {
	readonly depth: LevelTab['depth']
	readonly label: string
	readonly selected: boolean
	/** Not written yet: drawn fainter. */
	readonly muted: boolean
	readonly dot: 'queued' | 'researching' | null
	readonly dotLabel: string | null
}

/** A wait panel's button: an action to run, or the category sheet to open. */
export interface WaitControl {
	readonly key: WaitButton
	readonly label: string
	readonly variant: 'primary' | 'tonal' | 'outline'
	readonly action: CardAction | null
}

export interface SourceLink extends CardSource {
	/** The address as the card shows it: host and path, no scheme. */
	readonly host: string
}

const headingKeys = {
	translation: 'headingTranslation',
	examples: 'headingExamples',
	modelSentences: 'headingModelSentences',
	mistake: 'headingMistake',
	nuance: 'headingNuance',
	synonyms: 'headingSynonyms',
	collocations: 'headingCollocations',
	exercises: 'headingExercises',
	whatItIs: 'headingWhatItIs',
	analogy: 'headingAnalogy',
	relevance: 'headingRelevance',
	alternatives: 'headingAlternatives',
	worksWith: 'headingWorksWith',
	explanation: 'headingExplanation',
	example: 'headingExample',
	seenIn: 'headingSeenIn',
	inShort: 'headingInShort',
	existing: 'headingExisting',
	approaches: 'headingApproaches',
	risks: 'headingRisks',
	firstSteps: 'headingFirstSteps',
	gaps: 'headingGaps',
	howItWorks: 'headingHowItWorks',
	tradeoffs: 'headingTradeoffs',
	steps: 'headingSteps',
	recommendation: 'headingRecommendation',
	architecture: 'headingArchitecture',
	unknowns: 'headingUnknowns',
	effort: 'headingEffort',
	prototype: 'headingPrototype',
	milestones: 'headingMilestones',
	tools: 'headingTools',
} as const satisfies Record<BlockHeading, keyof CardMessages>

export function headingText(strings: CardMessages, heading: BlockHeading): string {
	return strings[headingKeys[heading]]
}

const difficultyKeys = { easy: 'easy', medium: 'medium', hard: 'hard' } as const

/** The line under the title: a word's part of speech before its sense. */
export function senseLine(view: CardView): string | null {
	if (view.sense === null) {
		return null
	}

	return view.facts === null ? view.sense : `${view.facts.partOfSpeech} · ${view.sense}`
}

export function difficultyText(strings: CardMessages, view: CardView): string | null {
	return view.facts === null ? null : strings[difficultyKeys[view.facts.difficulty]]
}

export function readingTime(strings: CardMessages, view: CardView): string | null {
	const minutes = view.readingMinutes

	return minutes === null ? null : counted(strings.minutesOne, strings.minutesOther, minutes)
}

export function levelControls(
	view: CardView,
	layout: CardLayout,
	strings: CardMessages,
): LevelControl[] {
	const shown = layout.panel.depth

	return (layout.levels ?? []).map(({ depth, state }) => {
		const dot = state === 'queued' || state === 'researching' ? state : null

		return {
			depth,
			label: levelName(strings, view.levelSet, depth),
			selected: depth === shown,
			muted: state !== 'ready',
			dot,
			dotLabel: dot === null ? null : strings[dot === 'queued' ? 'levelWaits' : 'levelWriting'],
		}
	})
}

const waitButtons = {
	researchNow: { label: 'researchNow', variant: 'tonal', action: { kind: 'research' } },
	researchLevel: { label: 'researchNow', variant: 'tonal', action: { kind: 'researchLevel' } },
	tryAgain: { label: 'tryAgain', variant: 'primary', action: { kind: 'research' } },
	changeCategory: { label: 'changeCategory', variant: 'outline', action: null },
} as const satisfies Record<
	WaitButton,
	{ label: keyof CardMessages; variant: WaitControl['variant']; action: CardAction | null }
>

export interface WaitScreen extends WaitTexts {
	readonly steps: readonly { readonly text: string; readonly state: string }[] | null
	readonly buttons: readonly WaitControl[]
}

export function waitScreen(view: CardView, panel: WaitPanel, context: ScreenContext): WaitScreen {
	const { strings } = context

	return {
		...waitTexts(view, panel, context),
		steps:
			panel.steps?.map((step) => ({ text: stepText(strings, step), state: step.state })) ?? null,
		buttons: panel.buttons.map((key) => {
			const { label, variant, action } = waitButtons[key]

			return { key, label: strings[label], variant, action }
		}),
	}
}

export function bannerScreen(layout: CardLayout, context: ScreenContext): BannerTexts | null {
	return layout.panel.kind === 'blocks' ? bannerTexts(layout.panel, context) : null
}

export function metaScreen(view: CardView, layout: CardLayout, context: ScreenContext): string {
	return layout.panel.kind === 'blocks' ? metaLine(view, layout.panel, context) : ''
}

/** A source with the address it shows; an address that does not parse shows as stored. */
export function sourceLinks(sources: readonly CardSource[]): SourceLink[] {
	return sources.map(({ title, url }) => {
		try {
			const parsed = new URL(url)
			const path = parsed.pathname.replace(/\/$/u, '')

			return { title, url, host: `${parsed.host.replace(/^www\./u, '')}${path}` }
		} catch {
			return { title, url, host: url }
		}
	})
}

/** Whether a card with no sources says so: every format but a word's (board 13 against 01). */
export function showsNoSources(view: CardView): boolean {
	return view.levelSet !== 'word'
}

/** The owner may archive a note from these statuses (notes `ownerTransitions`). */
export function canArchive(view: CardView): boolean {
	return ['new', 'ready', 'read', 'failed'].includes(view.note.status)
}

/*
 * Google's Search Suggestions as the frame's document, unmodified after two tags: links open a new
 * tab, and no page they open learns this instance's address.
 */
export function suggestionsDocument(html: string): string {
	return `<base target="_blank"><meta name="referrer" content="no-referrer">${html}`
}
