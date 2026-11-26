// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { describe, expect, it } from 'bun:test'
import { cardView, jobView, levelCard, levels, type LevelParts } from '#tests/factories/card-views'

import { cardLayout, researchSteps, type CardLayout } from './card-panel'

const progress = { step: 'searching', questions: 5, searched: 2, pages: 14 } as const

const askedNow = jobView({ priority: 'now', ahead: 1 })

const writing = jobView({ state: 'researching' })

function withLevels(...given: LevelParts[]) {
	return cardView('technology', { note: { status: 'read' }, levels: levels(...given) })
}

function ideaAt(step: 'planning' | 'searching' | 'writing') {
	return cardView('report', { research: { progress: { ...progress, step } } })
}

/** What a level shows, apart from its blocks. */
function summary(layout: CardLayout) {
	const { panel } = layout

	return {
		panel: panel.kind === 'wait' ? panel.reason : 'blocks',
		flag: layout.flag,
		buttons: panel.kind === 'wait' ? panel.buttons : [],
		levels: layout.levels?.map(({ state }) => state) ?? null,
		actions: layout.actions?.map(({ key }) => key) ?? null,
	}
}

describe('card panel levels', () => {
	describe('a deeper level', () => {
		const first = { card: levelCard('technology', 1) }

		it('shows a written level 2 with its own flag', () => {
			const second = levelCard('technology', 2, { isUncertain: true })
			const view = withLevels(first, { card: second })

			expect(summary(cardLayout(view, 2))).toMatchObject({
				panel: 'blocks',
				flag: 'unsure',
				levels: ['ready', 'ready', 'none'],
			})
		})

		it.each([
			{
				name: 'comes tonight with Research now',
				job: jobView(),
				reason: 'levelTonight',
				buttons: ['researchLevel'],
				state: 'queued',
			},
			{
				name: 'waits in the queue',
				job: askedNow,
				reason: 'levelQueued',
				buttons: [],
				state: 'queued',
			},
			{
				name: 'is being written',
				job: writing,
				reason: 'levelResearching',
				buttons: [],
				state: 'researching',
			},
		] as const)('$name', ({ job, reason, buttons, state }) => {
			const layout = cardLayout(withLevels(first, { job }), 2)

			expect(summary(layout)).toMatchObject({
				panel: reason,
				buttons,
				levels: ['ready', state, 'none'],
				actions: null,
			})
		})

		it('offers the next level with Research now, and the one after it with nothing', () => {
			const view = withLevels(first)

			expect([summary(cardLayout(view, 2)), summary(cardLayout(view, 3))]).toMatchObject([
				{ panel: 'levelNotWritten', buttons: ['researchLevel'] },
				{ panel: 'levelAfter', buttons: [] },
			])
		})
	})

	describe('researchSteps', () => {
		it('plans first, then searches, then writes', () => {
			expect(researchSteps(ideaAt('planning'))?.map(({ key, state }) => `${key} ${state}`)).toEqual(
				['planning active', 'search todo', 'write todo'],
			)
			expect(researchSteps(ideaAt('writing'))).toEqual([
				{ key: 'split', state: 'done', count: 5 },
				{ key: 'searched', state: 'done', count: 14 },
				{ key: 'writing', state: 'active', count: null },
			])
		})

		it('has no steps without progress', () => {
			expect(researchSteps(cardView('report'))).toBeNull()
		})
	})
})
