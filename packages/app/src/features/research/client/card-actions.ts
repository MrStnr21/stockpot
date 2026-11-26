// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

/*
 * One card action's request and what the card does after it (WEB-5 decision 3). Nothing is
 * optimistic: after a success the card is fetched again, so it always shows what the server holds.
 */
import type { CardView } from '../shared/card-view'
import type { CardApi, CardResult } from './card-api'
import type { Depth } from './card-panel'
import { levelName, type CardStrings } from './card-text'

export type CardAction =
	/** ✅ Got it: ready → read. */
	| { readonly kind: 'got' }
	/** 🔍 Deeper: the next level in tonight's run. */
	| { readonly kind: 'deeper' }
	/** Research now on a level that waits: the next level at once. */
	| { readonly kind: 'researchLevel' }
	/** Research now on a new note, or Try again on a failed one. */
	| { readonly kind: 'research' }
	/** 📌 Keep or Kept: the opposite of what the card shows. */
	| { readonly kind: 'keep' }
	| { readonly kind: 'delete' }
	| { readonly kind: 'undo' }
	| { readonly kind: 'archive' }
	| { readonly kind: 'move'; readonly categoryId: number | null; readonly categoryName: string }

export type ActionKind = CardAction['kind']

export type ActionOutcome =
	/** Fetch the card again, then show the toast and, if given, that level. */
	| { readonly kind: 'done'; readonly toast: string | null; readonly depth: Depth | null }
	/** The note is gone: Undo brings it back only when this card deleted it. */
	| { readonly kind: 'deleted'; readonly canUndo: boolean }
	| { readonly kind: 'missing' }
	| { readonly kind: 'signIn' }
	/** The note changed meanwhile: fetch the card again and say so. */
	| { readonly kind: 'conflict' }
	| { readonly kind: 'error'; readonly toast: string }

function done(toast: string | null = null, depth: Depth | null = null): ActionOutcome {
	return { kind: 'done', toast, depth }
}

function settled<T>(
	result: CardResult<T>,
	strings: CardStrings,
	onOk: (value: T) => ActionOutcome,
): ActionOutcome {
	switch (result.kind) {
		case 'ok': {
			return onOk(result.value)
		}

		case 'unauthorized': {
			return { kind: 'signIn' }
		}

		case 'missing': {
			return { kind: 'missing' }
		}

		case 'conflict': {
			return { kind: 'conflict' }
		}

		case 'unavailable': {
			return { kind: 'error', toast: strings.jobsUnavailableToast }
		}

		case 'failed': {
			return { kind: 'error', toast: strings.failedToast }
		}

		default: {
			throw new Error('A request ended in a way the card does not know.')
		}
	}
}

async function goDeeper(
	api: CardApi,
	view: CardView,
	{ now, strings }: { now: boolean; strings: CardStrings },
): Promise<ActionOutcome> {
	const result = await api.deeper(view.note.id, now)

	return settled(result, strings, ({ outcome, depth }) => {
		if (outcome === 'deepest' || depth === null || now) {
			return done(null, depth)
		}

		const level = levelName(strings, view.levelSet, depth)

		return done(strings.levelTonightTitle.replaceAll('{level}', level), depth)
	})
}

/** Sends the action for the note the card shows and says what the card does next. */
export async function sendAction(
	api: CardApi,
	view: CardView,
	{ action, strings }: { action: CardAction; strings: CardStrings },
): Promise<ActionOutcome> {
	const { id, isKept } = view.note

	switch (action.kind) {
		case 'got': {
			const result = await api.change(id, { status: 'read' })

			return settled(result, strings, () => done(strings.markedReadToast))
		}

		case 'deeper':
		case 'researchLevel': {
			return goDeeper(api, view, { now: action.kind === 'researchLevel', strings })
		}

		case 'research': {
			return settled(await api.research(id), strings, () => done())
		}

		case 'keep': {
			const result = await api.change(id, { kept: !isKept })

			return settled(result, strings, () => done(isKept ? strings.unkeptToast : strings.keptToast))
		}

		case 'delete': {
			const result = await api.remove(id)

			// A second delete answers 404: the note is gone, but not by this card, so no Undo.
			if (result.kind === 'missing') {
				return { kind: 'deleted', canUndo: false }
			}

			return settled(result, strings, () => ({ kind: 'deleted', canUndo: true }))
		}

		case 'undo': {
			return settled(await api.change(id, { deleted: false }), strings, () => done())
		}

		case 'archive': {
			const result = await api.change(id, { status: 'archived' })

			return settled(result, strings, () => done(strings.archivedToast))
		}

		case 'move': {
			const result = await api.change(id, { categoryId: action.categoryId })
			const toast = strings.movedToast.replaceAll('{category}', action.categoryName)

			return settled(result, strings, () => done(toast))
		}

		default: {
			throw new Error('The card has no such action.')
		}
	}
}
