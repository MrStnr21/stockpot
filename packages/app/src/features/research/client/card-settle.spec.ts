// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { describe, expect, it } from 'bun:test'
import { cardView } from '#tests/factories/card-views'
import { cardStrings as strings } from '#tests/setup/card-strings'

import type { ActionOutcome } from './card-actions'
import { refetches, settlement } from './card-settle'

const view = cardView('brief', { note: { id: 3, status: 'ready' } })

describe('settlement', () => {
	it.each<[string, ActionOutcome, object]>([
		[
			'done',
			{ kind: 'done', toast: 'Kept in Base', depth: 2 },
			{ depth: 2, toast: { title: 'Kept in Base', tone: 'default' }, notesChanged: true },
		],
		[
			'conflict',
			{ kind: 'conflict' },
			{ toast: { title: strings.conflictToast, tone: 'default' } },
		],
		[
			'deleted',
			{ kind: 'deleted', canUndo: true },
			{ state: { kind: 'deleted', view, canUndo: true }, notesChanged: true },
		],
		['missing', { kind: 'missing' }, { state: { kind: 'missing' }, notesChanged: true }],
	])('settles %s on the card on screen', (_, outcome, expected) => {
		expect(settlement(view, outcome, { onScreen: true, strings })).toMatchObject(expected)
	})

	it.each<[string, ActionOutcome, object]>([
		['done', { kind: 'done', toast: 'Kept in Base', depth: 2 }, { notesChanged: true }],
		['conflict', { kind: 'conflict' }, { notesChanged: false }],
		[
			'deleted',
			{ kind: 'deleted', canUndo: true },
			{ toast: { title: 'Note deleted', tone: 'default' }, notesChanged: true },
		],
		['missing', { kind: 'missing' }, { notesChanged: true }],
		['signIn', { kind: 'signIn' }, { signIn: true }],
		[
			'error',
			{ kind: 'error', toast: strings.failedToast },
			{ toast: { title: strings.failedToast, tone: 'error' } },
		],
	])('leaves the card alone for %s once the pane moved on', (_, outcome, expected) => {
		const settled = settlement(view, outcome, { onScreen: false, strings })

		expect(settled).toMatchObject({ state: null, depth: null, ...expected })
	})

	it('fetches the card again only after a change or a conflict', () => {
		const outcomes: ActionOutcome[] = [
			{ kind: 'done', toast: null, depth: null },
			{ kind: 'conflict' },
			{ kind: 'deleted', canUndo: true },
			{ kind: 'missing' },
			{ kind: 'signIn' },
		]

		expect(outcomes.map((outcome) => refetches(outcome))).toEqual([true, true, false, false, false])
	})
})
