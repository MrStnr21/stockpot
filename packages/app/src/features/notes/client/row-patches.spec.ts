// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { beforeEach, describe, expect, it } from 'bun:test'
import { listedNoteFactory } from '#tests/factories/listed-notes'

import { noFilters } from '../shared/filters'
import type { NoteRow } from '../shared/types'
import { RowPatches } from './row-patches'

describe('RowPatches', () => {
	let patches: RowPatches
	let row: NoteRow

	beforeEach(() => {
		patches = new RowPatches()
		row = listedNoteFactory.build({ status: 'new', categoryId: 1 })
	})

	it('applies a patch to answers sent before it, not after', () => {
		const before = patches.stamp()

		patches.record(new Map([[row.id, { kind: 'set', status: 'archived' }]]), [], noFilters)

		const after = patches.stamp()

		expect(patches.merge([row], before, noFilters)).toEqual([{ ...row, status: 'archived' }])
		expect(patches.merge([row], after, noFilters)).toEqual([row])
	})

	it('keeps the fields of an earlier patch that a later one leaves alone', () => {
		const sentAt = patches.stamp()

		patches.record(new Map([[row.id, { kind: 'set', categoryId: 3 }]]), [], noFilters)
		patches.record(new Map([[row.id, { kind: 'set', status: 'queued' }]]), [], noFilters)

		expect(patches.merge([row], sentAt, noFilters)).toEqual([
			{ ...row, status: 'queued', categoryId: 3 },
		])
	})

	it('keeps a removed note removed', () => {
		const sentAt = patches.stamp()

		patches.record(new Map([[row.id, { kind: 'remove' }]]), [], noFilters)
		patches.record(new Map([[row.id, { kind: 'set', status: 'ready' }]]), [], noFilters)

		expect(patches.merge([row], sentAt, noFilters)).toEqual([])
	})

	it('drops a patched row that left the filters, and leaves the others as they are', () => {
		const other = listedNoteFactory.build({ status: 'new' })

		const rows = patches.record(
			new Map([[row.id, { kind: 'set', status: 'archived' }]]),
			[row, other],
			{ ...noFilters, status: 'new' },
		)

		expect(rows).toEqual([other])
	})

	it('forgets the patches older than a first page', () => {
		const sentAt = patches.stamp()

		patches.record(new Map([[row.id, { kind: 'set', status: 'archived' }]]), [], noFilters)
		patches.dropBefore(patches.stamp())

		expect(patches.merge([row], sentAt, noFilters)).toEqual([row])
	})
})
