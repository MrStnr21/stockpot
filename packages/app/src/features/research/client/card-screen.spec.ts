// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { describe, expect, it } from 'bun:test'
import { cardView, jobView, levelCard, levels } from '#tests/factories/card-views'

import { cardEn } from '#/lib/i18n/card-en'
import { cardRu } from '#/lib/i18n/card-ru'

import { blockHeadings } from '../shared/blocks'
import type { CardView } from '../shared/card-view'
import { actionControls } from './card-action-controls'
import { cardLayout } from './card-panel'
import {
	canArchive,
	headingText,
	levelControls,
	readingTime,
	senseLine,
	showsNoSources,
	sourceLinks,
	suggestionsDocument,
	waitScreen,
	type ScreenContext,
} from './card-screen'

const context: ScreenContext = {
	strings: cardEn,
	locale: 'en',
	timeZone: 'UTC',
	batchTime: '06:30',
}

const facts = { partOfSpeech: 'noun', difficulty: 'medium', youglish: null } as const

function ready(changes: Partial<CardView['note']> = {}) {
	const card = levelCard('vocabulary', 1)

	return cardView('vocabulary', { note: { status: 'ready', ...changes }, levels: levels({ card }) })
}

describe('card screen', () => {
	it.each([cardEn, cardRu])('names every block heading', (strings) => {
		const headings = blockHeadings.map((heading) => headingText(strings, heading))

		expect(headings.every((text) => text.trim() !== '')).toBe(true)
	})

	it('puts a word’s part of speech before its sense', () => {
		expect(senseLine({ ...ready(), sense: 'a lucky find', facts })).toBe('noun · a lucky find')
		expect(senseLine({ ...ready(), sense: 'a lucky find' })).toBe('a lucky find')
		expect(senseLine(ready())).toBeNull()
	})

	it('counts the reading time', () => {
		expect([
			readingTime(cardEn, { ...ready(), readingMinutes: 1 }),
			readingTime(cardEn, { ...ready(), readingMinutes: 6 }),
			readingTime(cardEn, ready()),
		]).toEqual(['1 min', '6 min', null])
	})

	it('names the levels, marks the one shown, and dots the ones on their way', () => {
		const view = cardView('vocabulary', {
			note: { status: 'ready' },
			levels: levels({ card: levelCard('vocabulary', 1) }, { job: jobView() }),
		})

		expect(levelControls(view, cardLayout(view, 1), cardEn)).toEqual([
			{ depth: 1, label: 'Card', selected: true, muted: false, dot: null, dotLabel: null },
			{ depth: 2, label: 'Nuance', selected: false, muted: true, dot: 'queued', dotLabel: 'Waits' },
			{ depth: 3, label: 'Practice', selected: false, muted: true, dot: null, dotLabel: null },
		])
	})

	it('offers Try again and Change category on a failed card', () => {
		const view = cardView('concept', { note: { status: 'failed' } })
		const { panel } = cardLayout(view, 1)
		const screen = panel.kind === 'wait' ? waitScreen(view, panel, context) : null

		expect(screen?.buttons).toEqual([
			{ key: 'tryAgain', label: 'Try again', variant: 'primary', action: { kind: 'research' } },
			{ key: 'changeCategory', label: 'Change category', variant: 'outline', action: null },
		])
	})

	it('labels Keep as Kept on a kept note, and waits while an action runs', () => {
		const kept = cardLayout(ready({ isKept: true }), 1)

		expect(actionControls(kept, cardEn, true).map(({ label, tone }) => `${label} ${tone}`)).toEqual(
			['Got it accent', 'Deeper default', 'Kept accent', 'Delete default'],
		)
		expect(actionControls(kept, cardEn, false).every(({ disabled }) => disabled)).toBe(true)
	})

	it('shows a source by host and path', () => {
		expect(
			sourceLinks([
				{ title: 'Docs', url: 'https://www.example.com/docs/' },
				{ title: 'Home', url: 'https://example.org' },
			]).map(({ host }) => host),
		).toEqual(['example.com/docs', 'example.org'])
	})

	it('says a card has no sources, except a word’s', () => {
		expect([showsNoSources(cardView('brief')), showsNoSources(cardView('vocabulary'))]).toEqual([
			true,
			false,
		])
	})

	it('offers Archive where the owner may archive', () => {
		expect([
			canArchive(ready()),
			canArchive(ready({ status: 'researching' })),
			canArchive(ready({ status: 'archived' })),
		]).toEqual([true, false, false])
	})

	it('opens suggestion links in a new tab and sends no referrer', () => {
		expect(suggestionsDocument('<a href="https://google.com/search?q=x">x</a>')).toBe(
			'<base target="_blank"><meta name="referrer" content="no-referrer"><a href="https://google.com/search?q=x">x</a>',
		)
	})
})
