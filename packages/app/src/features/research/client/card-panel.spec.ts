// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { describe, expect, it } from 'bun:test'
import { cardView, jobView, levelCard, levels } from '#tests/factories/card-views'

import { formatIds, type FormatId } from '#/lib/format-ids'

import type { CardView } from '../shared/card-view'
import { cardLayout, type CardLayout } from './card-panel'

type Row = 'new' | 'queued' | 'researching' | 'ready' | 'draft' | 'failed' | 'unsure'

const rows = ['new', 'queued', 'researching', 'ready', 'draft', 'failed', 'unsure'] as const

const progress = { step: 'searching', questions: 5, searched: 2, pages: 14 } as const

const askedNow = jobView({ priority: 'now', ahead: 1 })

const writing = jobView({ state: 'researching' })

/** Level 1 written in `format`, the rest empty. */
function written(format: FormatId, values: Parameters<typeof levelCard>[2] = {}) {
	const card = levelCard(format, 1, values)

	return levels({ card })
}

/** A card in `format` as the CardStates board draws it in `row`. */
function boardCard(format: FormatId, row: Row): CardView {
	switch (row) {
		case 'new': {
			return cardView(format)
		}

		case 'queued': {
			return cardView(format, {
				note: { status: 'queued' },
				levels: levels({ job: askedNow }),
			})
		}

		case 'researching': {
			return cardView(format, {
				note: { status: 'researching' },
				levels: levels({ job: writing }),
				research: { progress: format === 'report' ? progress : null },
			})
		}

		case 'failed': {
			return cardView(format, { note: { status: 'failed' } })
		}

		case 'draft': {
			return cardView(format, {
				note: { status: 'ready' },
				levels: written(format, { isDraft: true }),
			})
		}

		case 'unsure': {
			return cardView(format, {
				note: { status: 'ready' },
				levels: written(format, { isUncertain: true }),
			})
		}

		case 'ready': {
			return cardView(format, { note: { status: 'ready' }, levels: written(format) })
		}

		default: {
			throw new Error('The board has no such row.')
		}
	}
}

/** What the board shows in each row, apart from the blocks. */
function summary(layout: CardLayout) {
	const { panel } = layout

	return {
		panel: panel.kind === 'wait' ? panel.reason : 'blocks',
		flag: layout.flag,
		banner: panel.kind === 'blocks' ? panel.banner : null,
		buttons: panel.kind === 'wait' ? panel.buttons : [],
		levels: layout.levels?.map(({ state }) => state) ?? null,
		actions: layout.actions?.map(({ key, disabled }) => (disabled ? `${key} off` : key)) ?? null,
	}
}

const writtenActions = ['got', 'deeper', 'keep', 'delete']

const expected: Record<Row, ReturnType<typeof summary>> = {
	new: {
		panel: 'new',
		flag: null,
		banner: null,
		buttons: ['researchNow'],
		levels: null,
		actions: null,
	},
	queued: { panel: 'queued', flag: null, banner: null, buttons: [], levels: null, actions: null },
	researching: {
		panel: 'researching',
		flag: null,
		banner: null,
		buttons: [],
		levels: ['researching', 'none', 'none'],
		actions: null,
	},
	ready: {
		panel: 'blocks',
		flag: null,
		banner: null,
		buttons: [],
		levels: ['ready', 'none', 'none'],
		actions: writtenActions,
	},
	draft: {
		panel: 'blocks',
		flag: 'draft',
		banner: 'draft',
		buttons: [],
		levels: ['ready', 'none', 'none'],
		actions: writtenActions,
	},
	failed: {
		panel: 'failed',
		flag: null,
		banner: null,
		buttons: ['tryAgain', 'changeCategory'],
		levels: null,
		actions: null,
	},
	unsure: {
		panel: 'blocks',
		flag: 'unsure',
		banner: 'unsure',
		buttons: [],
		levels: ['ready', 'none', 'none'],
		actions: writtenActions,
	},
}

/* The ready column of Cards · 390: each format's blocks in board order. */
const boardBlocks: Record<FormatId, string[]> = {
	vocabulary: ['text translation', 'examples examples', 'list modelSentences', 'note mistake'],
	technology: ['text whatItIs', 'text analogy'],
	comparison: ['text whatItIs', 'compare alternatives', 'tags worksWith'],
	concept: ['text explanation', 'text analogy', 'text example', 'list seenIn'],
	report: ['text inShort', 'pairs existing', 'pairs approaches', 'list risks', 'steps firstSteps'],
	brief: ['text explanation'],
}

const matrix = formatIds.flatMap((format) => rows.map((row) => [format, row] as const))

describe('card panel', () => {
	describe('cardLayout', () => {
		it.each(matrix)('draws a %s card in the %s state as the board does', (format, row) => {
			const layout = cardLayout(boardCard(format, row), 1)

			expect(summary(layout)).toEqual(expected[row])
		})

		it.each(formatIds)('shows the %s blocks in board order once ready', (format) => {
			const { panel } = cardLayout(boardCard(format, 'ready'), 1)
			const blocks = panel.kind === 'blocks' ? panel.card.blocks : null

			expect(blocks?.map(({ kind, heading }) => `${kind} ${heading}`)).toEqual(boardBlocks[format])
		})

		it.each(formatIds)(
			'holds the place of a %s card being researched with a skeleton',
			(format) => {
				const { panel } = cardLayout(boardCard(format, 'researching'), 1)

				expect(panel).toMatchObject({ kind: 'wait', icon: 'spinner', skeleton: true })
			},
		)

		it('shows the steps of an idea while it is researched, and of nothing else', () => {
			const idea = cardLayout(boardCard('report', 'researching'), 1).panel
			const word = cardLayout(boardCard('vocabulary', 'researching'), 1).panel

			expect([idea.kind === 'wait' && idea.steps, word.kind === 'wait' && word.steps]).toEqual([
				[
					{ key: 'split', state: 'done', count: 5 },
					{ key: 'searching', state: 'active', count: 14 },
					{ key: 'write', state: 'todo', count: null },
				],
				null,
			])
		})

		it('marks a failed card with the danger tone', () => {
			expect(cardLayout(boardCard('concept', 'failed'), 1).panel).toMatchObject({
				tone: 'danger',
				icon: 'alert',
			})
		})

		it('lets a draft win over an unsure answer', () => {
			const view = cardView('brief', {
				note: { status: 'ready' },
				levels: levels({ card: levelCard('brief', 1, { isDraft: true, isUncertain: true }) }),
			})

			expect(cardLayout(view, 1).flag).toBe('draft')
		})

		it('enables Got it only on a ready card', () => {
			const read = cardView('brief', {
				note: { status: 'read' },
				levels: levels({ card: levelCard('brief', 1) }),
			})

			expect(cardLayout(read, 1).actions?.[0]).toEqual({
				key: 'got',
				disabled: true,
				pressed: false,
			})
		})

		it('disables Deeper once level 3 is written, and presses Keep on a kept note', () => {
			const view = cardView('technology', {
				note: { status: 'ready', isKept: true },
				levels: levels(
					{ card: levelCard('technology', 1) },
					{ card: levelCard('technology', 2) },
					{ card: levelCard('technology', 3) },
				),
			})

			expect(cardLayout(view, 3).actions?.slice(1, 3)).toEqual([
				{ key: 'deeper', disabled: true, pressed: false },
				{ key: 'keep', disabled: false, pressed: true },
			])
		})

		it('offers Notion before Delete only when the page turns it on', () => {
			const view = boardCard('vocabulary', 'ready')

			expect(cardLayout(view, 1, 'add').actions?.map(({ key }) => key)).toEqual([
				'got',
				'deeper',
				'keep',
				'notion',
				'delete',
			])
			expect(cardLayout(view, 1, 'in').actions?.[3]).toEqual({
				key: 'notion',
				disabled: false,
				pressed: true,
			})
		})

		it('shows level 1 when a deeper level is picked before level 1 exists', () => {
			expect(cardLayout(boardCard('brief', 'queued'), 3).panel).toMatchObject({ depth: 1 })
		})
	})
})
