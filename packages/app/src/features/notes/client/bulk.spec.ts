// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { describe, expect, it } from 'bun:test'

import type { NoteStatus, ResearchOutcome } from '../shared/types'
import { changeFor, settleChange, settleResearch } from './bulk'
import type { RowPatch } from './row-patches'

describe('bulk answers', () => {
	describe('settleResearch', () => {
		it.each<[ResearchOutcome, NoteStatus | undefined, RowPatch | undefined]>([
			['queued', 'new', { kind: 'set', status: 'queued' }],
			['queued', 'archived', { kind: 'set', status: 'queued' }],
			['queued', undefined, { kind: 'set', status: 'queued' }],
			['pending', 'archived', { kind: 'set', status: 'queued' }],
			['pending', 'researching', undefined],
			['done', 'archived', { kind: 'set', status: 'ready' }],
			['done', 'read', undefined],
			['done', undefined, undefined],
			['not_found', 'new', { kind: 'remove' }],
		])('maps %s for a %s row to %o', (outcome, status, patch) => {
			const { patches } = settleResearch([{ id: 1, outcome }], () => status)

			expect(patches.get(1)).toEqual(patch)
		})

		it('ends the selection and counts the notes reached and gone', () => {
			const settlement = settleResearch(
				[
					{ id: 1, outcome: 'queued' },
					{ id: 2, outcome: 'done' },
					{ id: 3, outcome: 'not_found' },
				],
				() => 'new',
			)

			expect(settlement.keep.size).toBe(0)
			expect(settlement.summary).toEqual({
				action: { kind: 'research' },
				done: 2,
				conflicts: 0,
				deleted: 1,
			})
		})
	})

	describe('settleChange', () => {
		const settlement = settleChange({ kind: 'archive' }, [
			{ id: 1, outcome: 'changed', note: { status: 'archived', categoryId: 2 } },
			{ id: 2, outcome: 'unchanged', note: { status: 'archived', categoryId: null } },
			{ id: 3, outcome: 'conflict', note: { status: 'researching', categoryId: 2 } },
			{ id: 4, outcome: 'not_found', note: null },
		])

		it('takes changed and unchanged notes as answered and removes the gone', () => {
			expect([...settlement.patches]).toEqual([
				[1, { kind: 'set', status: 'archived', categoryId: 2 }],
				[2, { kind: 'set', status: 'archived', categoryId: null }],
				[4, { kind: 'remove' }],
			])
		})

		it('keeps only conflicts selected', () => {
			expect([...settlement.keep]).toEqual([3])
			expect(settlement.summary).toMatchObject({ done: 2, conflicts: 1, deleted: 1 })
		})
	})

	describe('changeFor', () => {
		it('sends a category or the archive', () => {
			expect(changeFor({ kind: 'move', categoryId: 5 })).toEqual({ categoryId: 5 })
			expect(changeFor({ kind: 'archive' })).toEqual({ status: 'archived' })
		})
	})
})
