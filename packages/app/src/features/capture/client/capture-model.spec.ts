// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { describe, expect, it } from 'bun:test'
import { faker } from '@faker-js/faker'
import {
	historyMatchFactory,
	suggestAnswerFactory,
	suggestSenseFactory,
} from '#tests/factories/suggestions'

import {
	actionsFor,
	canSubmit,
	categoryRow,
	deeperNoteId,
	dismissSeen,
	dismissSenses,
	followAnswer,
	initialSelection,
	panelFor,
	pickCategory,
	pickSense,
	seenLine,
	usableAnswer,
	type CategoryRow,
} from './capture-model'
import type { SuggestionState } from './suggestions'

describe('capture model', () => {
	const saved = historyMatchFactory.build({ state: 'saved', categoryId: 2 })
	const seen = historyMatchFactory.build({ state: 'seen', categoryId: 4 })

	const senses = [
		suggestSenseFactory.build({ categoryId: 5 }),
		suggestSenseFactory.build({ categoryId: 6 }),
	]

	describe('panelFor', () => {
		it.each([
			['a saved match over everything', { history: [seen, saved], senses }, 'saved'],
			['meanings over a seen match', { history: [seen], senses }, 'senses'],
			['a seen match', { history: [seen] }, 'seen'],
			['a known term alone', { history: [historyMatchFactory.build({ state: 'known' })] }, null],
			['no history', {}, null],
		] as const)('shows %s', (_case, params, panel) => {
			expect(panelFor(suggestAnswerFactory.build(params), initialSelection)).toBe(panel)
		})

		it.each([
			['saved', 'saved'],
			['seen', 'seen'],
		] as const)('leaves the chips for a %s term without a category or a suggestion', (state) => {
			const match = historyMatchFactory.build({ state, categoryId: null })
			const answer = suggestAnswerFactory.build({ history: [match], categories: [] })

			expect(panelFor(answer, initialSelection)).toBeNull()
		})

		it('shows a saved term without a category when a category is suggested', () => {
			const match = historyMatchFactory.build({ state: 'saved', categoryId: null })
			const answer = suggestAnswerFactory.build({ history: [match], categories: [3] })

			expect(panelFor(answer, initialSelection)).toBe('saved')
			expect(followAnswer(initialSelection, answer).categoryId).toBe(3)
		})

		it('shows nothing before an answer', () => {
			expect(panelFor(null, initialSelection)).toBeNull()
		})

		it('leaves the chips after "None of these", even with a seen match', () => {
			const answer = suggestAnswerFactory.build({ history: [seen], senses })

			expect(panelFor(answer, dismissSenses(initialSelection, answer))).toBeNull()
		})

		it('hides the seen panel after "Different meaning"', () => {
			const answer = suggestAnswerFactory.build({ history: [seen] })

			expect(panelFor(answer, dismissSeen(initialSelection, answer))).toBeNull()
		})
	})

	describe('followAnswer', () => {
		it('picks the first suggested category', () => {
			const answer = suggestAnswerFactory.build({ categories: [3, 1] })

			expect(followAnswer(initialSelection, answer)).toEqual({ ...initialSelection, categoryId: 3 })
		})

		it('picks nothing when nothing was suggested', () => {
			const answer = suggestAnswerFactory.build({ categories: [] })

			expect(followAnswer(initialSelection, answer).categoryId).toBeNull()
		})

		it('picks the first meaning and its category', () => {
			const answer = suggestAnswerFactory.build({ categories: [1], senses })

			expect(followAnswer(initialSelection, answer)).toMatchObject({ senseIndex: 0, categoryId: 5 })
		})

		it.each([
			['saved', saved, 2],
			['seen', seen, 4],
		] as const)('picks the category of a %s match', (_case, match, categoryId) => {
			const answer = suggestAnswerFactory.build({ categories: [1], history: [match] })

			expect(followAnswer(initialSelection, answer).categoryId).toBe(categoryId)
		})

		it('keeps a chip the owner picked when a later answer arrives', () => {
			const picked = pickCategory(initialSelection, 6)
			const later = suggestAnswerFactory.build({ categories: [1], senses, history: [seen] })

			expect(followAnswer(picked, later)).toBe(picked)
		})

		it('keeps a meaning the owner picked when a later answer arrives', () => {
			const answer = suggestAnswerFactory.build({ senses })
			const picked = pickSense(followAnswer(initialSelection, answer), answer, 1)

			expect(followAnswer(picked, suggestAnswerFactory.build({ senses }))).toMatchObject({
				senseIndex: 1,
				categoryId: 6,
			})
		})
	})

	describe('pickSense', () => {
		const answer = suggestAnswerFactory.build({ senses })

		it('sets the category of the meaning', () => {
			expect(pickSense(initialSelection, answer, 1)).toMatchObject({
				senseIndex: 1,
				categoryId: 6,
				isUserPick: true,
			})
		})

		it('ignores a meaning the answer does not have', () => {
			expect(pickSense(initialSelection, answer, 4)).toBe(initialSelection)
		})
	})

	describe('dismissSenses', () => {
		it('brings back the chips with the first suggestion picked', () => {
			const answer = suggestAnswerFactory.build({ categories: [3], senses })
			const picked = pickSense(followAnswer(initialSelection, answer), answer, 1)

			expect(dismissSenses(picked, answer)).toEqual({
				...initialSelection,
				categoryId: 3,
				sensesDismissed: true,
			})
		})
	})

	describe('dismissSeen', () => {
		it('picks the suggestion instead of the seen category', () => {
			const answer = suggestAnswerFactory.build({ categories: [3], history: [seen] })

			expect(dismissSeen(followAnswer(initialSelection, answer), answer).categoryId).toBe(3)
		})
	})

	describe('usableAnswer', () => {
		it('drops categories the sheet does not know', () => {
			const answer = suggestAnswerFactory.build({
				categories: [9, 1, 1, 2, 3, 4],
				senses: [suggestSenseFactory.build({ categoryId: 9 }), ...senses.slice(0, 1)],
				history: [historyMatchFactory.build({ categoryId: 9 })],
			})

			expect(usableAnswer(answer, [1, 2, 3, 4, 5, 6])).toMatchObject({
				categories: [1, 2, 3],
				senses: [],
				history: [{ categoryId: null }],
			})
		})
	})

	describe('actionsFor', () => {
		it.each([
			[null, { secondary: 'research', primary: 'save' }],
			['senses', { secondary: 'research', primary: 'save' }],
			['saved', { secondary: 'research', primary: 'addContext' }],
			['seen', { secondary: 'deeper', primary: 'repeat' }],
		] as const)('maps the %s panel', (panel, actions) => {
			expect(actionsFor(panel)).toEqual(actions)
		})
	})

	describe('canSubmit', () => {
		it.each([
			[null, false, false],
			[1, false, true],
			[1, true, false],
		])('with category %p and saving %p is %p', (categoryId, isSaving, expected) => {
			expect(canSubmit({ ...initialSelection, categoryId }, isSaving)).toBe(expected)
		})
	})

	describe('categoryRow', () => {
		const allIds = [1, 2, 3, 4, 5, 6]
		const ready = { kind: 'ready', text: 'Kafka' } as const

		it.each<[string, SuggestionState, CategoryRow]>([
			['the hint before a term', { kind: 'empty' }, { label: 'hint', ids: [] }],
			[
				'skeletons while asking',
				{ kind: 'loading', text: 'Kafka' },
				{ label: 'suggesting', ids: [] },
			],
			[
				'every category when nothing was suggested',
				{ ...ready, answer: suggestAnswerFactory.build({ categories: [] }) },
				{ label: 'plain', ids: allIds },
			],
			[
				'the suggestions',
				{ ...ready, answer: suggestAnswerFactory.build({ categories: [3, 1] }) },
				{ label: 'suggested', ids: [3, 1] },
			],
		])('shows %s', (_case, state, row) => {
			expect(categoryRow({ state, allIds, selection: initialSelection, showAll: false })).toEqual(
				row,
			)
		})

		it('shows every category when expanded', () => {
			const state = { ...ready, answer: suggestAnswerFactory.build({ categories: [3] }) }

			expect(categoryRow({ state, allIds, selection: initialSelection, showAll: true })).toEqual({
				label: 'all',
				ids: allIds,
			})
		})

		it('keeps a pick from every category in view once folded', () => {
			const state = { ...ready, answer: suggestAnswerFactory.build({ categories: [3] }) }

			const selection = pickCategory(initialSelection, 5)

			expect(categoryRow({ state, allIds, selection, showAll: false }).ids).toEqual([3, 5])
		})
	})

	describe('seenLine', () => {
		const meaning = faker.lorem.sentence()
		const sense = faker.lorem.sentence()

		it.each([
			['the last card sense', { lastCard: { noteId: 1, sense } }, sense],
			['the meaning without a card', { meaning, lastCard: null }, meaning],
			[
				'the meaning when the card has no sense',
				{ meaning, lastCard: { noteId: 1, sense: null } },
				meaning,
			],
			['nothing without either', { meaning: ' ', lastCard: null }, null],
		])('reads %s', (_case, params, line) => {
			expect(seenLine(historyMatchFactory.build(params))).toBe(line)
		})
	})

	describe('deeperNoteId', () => {
		it.each([
			[
				'the last card note',
				{ note: { id: 1, status: 'read' }, lastCard: { noteId: 2, sense: null } },
				2,
			],
			[
				'the note when the card has none',
				{ note: { id: 1, status: 'read' }, lastCard: { noteId: null, sense: null } },
				1,
			],
			['nothing without either', { note: null, lastCard: null }, null],
		] as const)('asks for %s', (_case, params, id) => {
			expect(deeperNoteId(historyMatchFactory.build(params))).toBe(id)
		})
	})
})
