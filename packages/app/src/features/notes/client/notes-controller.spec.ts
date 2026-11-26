// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { afterEach, beforeEach, describe, expect, it, jest } from 'bun:test'
import { listedNoteFactory, notesPageFactory } from '#tests/factories/listed-notes'
import { NotesHarness } from '#tests/setup/notes-controller'

import { noFilters } from '../shared/filters'
import type { NoteRow } from '../shared/types'
import { emptyKind, queryDebounceMs } from './list-loader'

const failure = { error: { code: 'internal', message: 'x' } }

function ids(rows: readonly NoteRow[]) {
	return rows.map(({ id }) => id)
}

describe('NotesController', () => {
	let harness: NotesHarness

	beforeEach(() => {
		jest.useFakeTimers()
	})

	afterEach(() => {
		harness.controller.destroy()
		jest.useRealTimers()
	})

	describe('selection', () => {
		beforeEach(() => {
			harness = new NotesHarness()
		})

		it('survives a filter change, a search and a refetch', () => {
			const selected = ids(harness.controller.view.rows).slice(0, 2)

			harness.select(...selected)
			harness.controller.setStatus('read')
			harness.requests.call(0).answer(notesPageFactory.build())
			harness.controller.typeQuery('kafka')
			jest.advanceTimersByTime(queryDebounceMs)
			harness.requests.call(1).answer(notesPageFactory.build())
			harness.controller.notesChanged()

			expect(harness.controller.view.rows).toEqual([])
			expect(harness.controller.selection).toEqual({ isActive: true, ids: selected })
		})

		it('refuses the 101st note with a toast', () => {
			harness.select(...Array.from({ length: 101 }, (_, index) => index + 1))

			expect(harness.controller.selection.ids).toHaveLength(100)
			expect(harness.toast()).toBe('Select up to 100 notes at a time')
		})

		it('starts with a long press and ends with Done', () => {
			harness.controller.press(4)

			expect(harness.controller.selected.has(4)).toBe(true)

			harness.controller.done()

			expect(harness.controller.selection).toEqual({ isActive: false, ids: [] })
		})
	})

	describe('filters', () => {
		beforeEach(() => {
			harness = new NotesHarness()
		})

		it('writes each change into the URL', () => {
			harness.controller.setStatus('ready')
			harness.controller.setCategory(2)
			harness.controller.typeQuery('kafka')
			jest.advanceTimersByTime(queryDebounceMs)
			harness.controller.clearSearch()
			harness.controller.clearFilters()

			expect(harness.urls).toEqual([
				'?status=ready',
				'?status=ready&categoryId=2',
				'?status=ready&categoryId=2&q=kafka',
				'?status=ready&categoryId=2',
				'',
			])
		})

		it('shows a toast when a page fails, and keeps the rows', () => {
			const { rows } = harness.controller.view

			harness.controller.setStatus('ready')
			harness.requests.call(0).answer(failure, 503)

			expect(harness.controller.view.rows).toEqual(rows)
			expect(harness.toast()).toBe('Couldn’t reach your server.')
			expect(harness.urls).toEqual(['?status=ready', ''])
		})

		it('draws day groups, and a flat list while searching', () => {
			expect(harness.controller.groups?.map(({ label }) => label)).toEqual(['Today'])

			harness.controller.typeQuery('kafka')
			jest.advanceTimersByTime(queryDebounceMs)

			expect(harness.controller.groups).toBeNull()
		})
	})

	describe('counts', () => {
		beforeEach(() => {
			harness = new NotesHarness()
		})

		it('keeps the answer to the latest request', async () => {
			const older = harness.controller.refreshCounts()
			const newer = harness.controller.refreshCounts()

			harness.requests.call(1).answer({ counts: [{ categoryId: 1, status: 'read', count: 9 }] })
			harness.requests.call(0).answer({ counts: [{ categoryId: 1, status: 'new', count: 1 }] })
			await Promise.all([older, newer])

			expect(harness.requests.call(0).signal?.aborted).toBe(true)
			expect(harness.controller.facets).toMatchObject({
				total: 9,
				statuses: [{ status: 'read', count: 9 }],
			})
		})

		it('refetches with the first page when notes changed elsewhere', () => {
			harness.controller.notesChanged()

			expect(harness.requests.calls.map(({ url }) => url)).toEqual([
				'/api/notes',
				'/api/notes/counts',
			])
		})
	})

	describe('emptyKind', () => {
		const view = {
			rows: [],
			nextCursor: null,
			total: null,
			filters: noFilters,
			isLoading: false,
			isLoadingMore: false,
			now: 0,
		}

		it.each([
			{ name: 'an instance without notes', shown: view, total: 0, kind: 'instance' },
			{
				name: 'a search without results',
				shown: { ...view, filters: { ...noFilters, q: 'x' } },
				total: 5,
				kind: 'search',
			},
			{
				name: 'filters without notes',
				shown: { ...view, filters: { ...noFilters, status: 'read' } },
				total: 5,
				kind: 'filters',
			},
			{
				name: 'a first page on its way',
				shown: { ...view, isLoading: true },
				total: 0,
				kind: null,
			},
			{
				name: 'rows',
				shown: { ...view, rows: listedNoteFactory.buildList(1) },
				total: 1,
				kind: null,
			},
		] as const)('is $kind for $name', ({ shown, total, kind }) => {
			expect(emptyKind(shown, total)).toBe(kind)
		})
	})
})
