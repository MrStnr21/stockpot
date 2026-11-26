// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { afterEach, beforeEach, describe, expect, it, jest } from 'bun:test'
import { cardView, jobView, levelCard, levels } from '#tests/factories/card-views'
import { cardStrings } from '#tests/setup/card-strings'

import type { CardView } from '../shared/card-view'
import { cardLayout, type BlocksPanel, type Depth, type WaitPanel } from './card-panel'
import {
	bannerTexts,
	engineName,
	levelName,
	metaLine,
	stepText,
	waitTexts,
	type TextContext,
} from './card-text'

const context: TextContext = {
	strings: cardStrings,
	locale: 'en',
	timeZone: 'Europe/Moscow',
	batchTime: '06:30',
}

const now = new Date('2026-11-19T07:00:00Z')

function waitOf(view: CardView, depth: Depth = 1): WaitPanel {
	const { panel } = cardLayout(view, depth)

	if (panel.kind !== 'wait') {
		throw new Error('The card shows its blocks, not a wait panel.')
	}

	return panel
}

function blocksOf(view: CardView, depth: Depth = 1): BlocksPanel {
	const { panel } = cardLayout(view, depth)

	if (panel.kind !== 'blocks') {
		throw new Error('The card shows a wait panel, not its blocks.')
	}

	return panel
}

function queued(ahead: number, values: Parameters<typeof jobView>[0] = {}) {
	return cardView('concept', {
		note: { status: 'queued' },
		levels: levels({ job: jobView({ ahead, ...values }) }),
	})
}

function written(format: Parameters<typeof levelCard>[0], values: Parameters<typeof levelCard>[2]) {
	return cardView(format, {
		note: { status: 'ready' },
		levels: levels({ card: levelCard(format, 1, values) }),
	})
}

describe('card text', () => {
	beforeEach(() => {
		jest.useFakeTimers({ now })
	})

	afterEach(() => {
		jest.useRealTimers()
	})

	describe('waitTexts', () => {
		it('says when tonight’s run explains a new note', () => {
			const view = cardView('concept')

			expect(waitTexts(view, waitOf(view), context)).toEqual({
				title: 'Waits for tonight',
				text: 'Explained in tonight’s run at 06:30 and shown in tomorrow’s digest.',
				meta: null,
			})
		})

		it.each([
			[0, 'It starts in a moment.'],
			[1, 'One note is ahead of it.'],
			[4, '4 notes are ahead of it.'],
		])('counts %d notes ahead of a queued card', (ahead, line) => {
			const view = queued(ahead)

			expect(waitTexts(view, waitOf(view), context).text).toBe(
				`${line} A card usually takes about a minute.`,
			)
		})

		it('says a report takes longer', () => {
			const view = cardView('report', {
				note: { status: 'queued' },
				levels: levels({ job: jobView() }),
			})

			expect(waitTexts(view, waitOf(view), context).text).toBe(
				'It starts in a moment. A report takes a few minutes.',
			)
		})

		it('gives the reset time of a job that waits for a limit, in the instance time zone', () => {
			const view = queued(0, { runAt: '2026-11-19T11:00:00.000Z' })

			expect(waitTexts(view, waitOf(view), context).text).toBe(
				'Waits for the engine’s limit to reset, around 14:00.',
			)
		})

		it('names the time Research now was asked', () => {
			const view = queued(1, { priority: 'now', queuedAt: '2026-11-19T06:12:00.000Z' })

			expect(waitTexts(view, waitOf(view), context).meta).toBe('Research now · asked at 09:12')
		})

		it.each([
			['timeout', 'The engine timed out.', 'Timeout · 2 retries · 09:41'],
			[
				'invalid',
				'The engine’s answer didn’t fit the card.',
				'Answer didn’t fit · 2 retries · 09:41',
			],
			[
				'error',
				'The engine couldn’t write it. Check the engine in Settings if this repeats.',
				'Error · 2 retries · 09:41',
			],
		] as const)('explains a %s failure', (kind, reason, meta) => {
			const view = cardView('concept', {
				note: { status: 'failed' },
				research: { failure: { kind, attempts: 3, at: '2026-11-19T06:41:00.000Z' } },
			})

			expect(waitTexts(view, waitOf(view), context)).toEqual({
				title: 'Couldn’t write this card',
				text: `${reason} Try again, or change the category first.`,
				meta,
			})
		})

		it('gives the generic reason and no meta when no failed job is known', () => {
			const view = cardView('concept', { note: { status: 'failed' } })

			expect(waitTexts(view, waitOf(view), context)).toMatchObject({
				text: 'The engine couldn’t write it. Check the engine in Settings if this repeats. Try again, or change the category first.',
				meta: null,
			})
		})

		it('names the levels that wait', () => {
			const view = cardView('technology', {
				note: { status: 'read' },
				levels: levels({ card: levelCard('technology', 1) }, { job: jobView() }),
			})

			const after = cardView('technology', {
				note: { status: 'read' },
				levels: levels({ card: levelCard('technology', 1) }),
			})

			expect([
				waitTexts(view, waitOf(view, 2), context).title,
				waitTexts(after, waitOf(after, 2), context).title,
				waitTexts(after, waitOf(after, 3), context).title,
			]).toEqual([
				'How it works comes tonight',
				'How it works isn’t written yet',
				'Comes after How it works',
			])
		})

		it('says an idea is being researched', () => {
			const view = cardView('report', { note: { status: 'researching' } })

			expect(waitTexts(view, waitOf(view), context).title).toBe('Researching the idea')
		})
	})

	describe('bannerTexts', () => {
		it.each([
			[null, 'Written by the backup engine while the main one was at its limit.'],
			[
				'2026-11-19T11:00:00.000Z',
				'Written by the backup engine while the main one was at its limit. It is rewritten after the limit resets, around 14:00.',
			],
		])('explains a draft with redo time %p', (redoAt, text) => {
			const panel = blocksOf(written('brief', { isDraft: true, redoAt }))

			expect(bannerTexts(panel, context)).toEqual({
				title: 'Draft.',
				text,
			})
		})

		it('explains an unsure card, and its missing sources', () => {
			const withSources = blocksOf(written('brief', { isUncertain: true }))
			const without = blocksOf(written('brief', { isUncertain: true, sources: [] }))

			expect([
				bannerTexts(withSources, context)?.text,
				bannerTexts(without, context)?.text,
			]).toEqual([
				'The engine couldn’t confirm the main facts. Read it with care, or try Deeper.',
				'The engine couldn’t confirm the main facts, and no source passed the link check. Read it with care, or try Deeper.',
			])
		})

		it('has no banner for a sure card', () => {
			const panel = blocksOf(written('brief', {}))

			expect(bannerTexts(panel, context)).toBeNull()
		})
	})

	describe('metaLine', () => {
		it.each([
			['gemini', 'Gemini'],
			['agent-command', 'the agent command'],
			['openai-compatible', 'the OpenAI-compatible engine'],
			['some-engine', 'some-engine'],
		])('names engine %s', (engine, name) => {
			const view = written('brief', { engine })

			expect(engineName(cardStrings, engine)).toBe(name)
			expect(metaLine(view, blocksOf(view), context)).toBe(`Written by ${name} · 19 Nov, 09:31`)
		})

		it('says a report was researched and a draft drafted', () => {
			const report = written('report', {})
			const draft = written('brief', { isDraft: true })

			expect([
				metaLine(report, blocksOf(report), context),
				metaLine(draft, blocksOf(draft), context),
			]).toEqual(['Researched by Gemini · 19 Nov, 09:31', 'Draft by Gemini · 19 Nov, 09:31'])
		})

		it('names a deeper level', () => {
			const view = cardView('technology', {
				note: { status: 'read' },
				levels: levels({ card: levelCard('technology', 1) }, { card: levelCard('technology', 2) }),
			})

			expect(metaLine(view, blocksOf(view, 2), context)).toBe(
				'Level 2 · written by Gemini · 19 Nov, 09:31',
			)
		})

		it('names the card language of a word, in the interface language', () => {
			const view = written('vocabulary', { language: 'ru' })

			expect([
				metaLine(view, blocksOf(view), context),
				metaLine(view, blocksOf(view), {
					...context,
					locale: 'ru',
					strings: { ...cardStrings, writtenBy: '{engine} · {time}' },
				}),
			]).toEqual([
				'Written by Gemini · 19 Nov, 09:31 · translations in Russian, the card language',
				'Gemini · 19 нояб., 09:31 · translations in Русский, the card language',
			])
		})
	})

	it('names each level set’s levels', () => {
		expect([
			levelName(cardStrings, 'standard', 3),
			levelName(cardStrings, 'word', 2),
			levelName(cardStrings, 'report', 1),
		]).toEqual(['Hands-on', 'Nuance', 'Report'])
	})

	it('counts the questions and pages of a research step', () => {
		expect([
			stepText(cardStrings, { key: 'split', state: 'done', count: 1 }),
			stepText(cardStrings, { key: 'searching', state: 'active', count: 14 }),
			stepText(cardStrings, { key: 'write', state: 'todo', count: null }),
		]).toEqual(['Split into 1 question', 'Searching: 14 pages read', 'Write the report'])
	})
})
