// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { afterEach, beforeEach, describe, expect, it, jest } from 'bun:test'
import { listedNoteFactory, notesPageFactory } from '#tests/factories/listed-notes'
import { NotesFetch } from '#tests/setup/notes-fetch'

import { noFilters, type NoteFilters } from '../shared/filters'
import type { NoteRow } from '../shared/types'
import { ListLoader, queryDebounceMs, type ListFailure } from './list-loader'
import { createNotesApi } from './notes-api'

const renderedAt = Date.parse('2026-11-26T10:00:00Z')

const answeredAt = Date.parse('2026-11-26T10:05:00Z')

function ids(rows: readonly NoteRow[]) {
	return rows.map(({ id }) => id)
}

function searchOf(url: string) {
	return Object.fromEntries(new URL(url, 'http://stockpot.test').searchParams)
}

describe('ListLoader', () => {
	let requests: NotesFetch
	let failures: ListFailure[]
	let first: NoteRow[]
	let loader: ListLoader

	function start(filters: NoteFilters = noFilters, nextCursor: string | null = 'page-2') {
		loader = new ListLoader({
			api: createNotesApi({ fetch: requests.fetch }),
			initial: notesPageFactory.build({ notes: first, nextCursor }),
			filters,
			renderedAt,
			now: () => answeredAt,
			onChange: () => {
				// The specs read `loader.view`.
			},
			onFailure: (failure) => {
				failures.push(failure)
			},
		})
	}

	beforeEach(() => {
		jest.useFakeTimers()
		requests = new NotesFetch()
		failures = []
		first = listedNoteFactory.buildList(3)
		start()
	})

	afterEach(() => {
		loader.stop()
		jest.useRealTimers()
	})

	describe('typing a search', () => {
		it('waits for a pause and sends the last text once', () => {
			loader.typeQuery('k')
			jest.advanceTimersByTime(queryDebounceMs - 1)
			loader.typeQuery('ka')
			jest.advanceTimersByTime(queryDebounceMs - 1)
			loader.typeQuery(' kaf ')

			expect(requests.calls).toHaveLength(0)

			jest.advanceTimersByTime(queryDebounceMs)

			expect(requests.calls.map(({ url }) => searchOf(url))).toEqual([{ q: 'kaf' }])
		})

		it('sends nothing when only spaces changed', () => {
			loader.typeQuery('   ')
			jest.advanceTimersByTime(queryDebounceMs)

			expect(requests.calls).toHaveLength(0)
		})

		it('flushes the typed text with a chip, at once and once', () => {
			loader.typeQuery('kaf')
			loader.setFilters({ status: 'new' })
			jest.advanceTimersByTime(queryDebounceMs * 2)

			expect(requests.calls.map(({ url }) => searchOf(url))).toEqual([{ status: 'new', q: 'kaf' }])
		})

		it('clears the search at once, dropping a pending pause', () => {
			start({ ...noFilters, q: 'kafka' })
			loader.typeQuery('kafkaesque')
			loader.setFilters({ q: '' })
			jest.advanceTimersByTime(queryDebounceMs)

			expect(requests.calls.map(({ url }) => url)).toEqual(['/api/notes'])
		})
	})

	describe('while a first page loads', () => {
		beforeEach(() => {
			loader.setFilters({ categoryId: 2 })
		})

		it('keeps the old rows, marked busy, and drops their cursor', () => {
			expect(loader.view).toMatchObject({
				rows: first,
				isLoading: true,
				nextCursor: null,
				filters: { categoryId: 2 },
			})
		})

		it('loads no more pages', () => {
			loader.loadMore()

			expect(requests.calls).toHaveLength(1)
		})

		it('replaces the rows with the answer and judges days from its arrival', () => {
			const rows = listedNoteFactory.buildList(2, { categoryId: 2 })

			requests.call(0).answer(notesPageFactory.build({ notes: rows, nextCursor: 'c2' }))

			expect(loader.view).toMatchObject({
				rows,
				nextCursor: 'c2',
				isLoading: false,
				now: answeredAt,
			})
		})

		it('keeps the old rows, filters and cursor when the answer fails', () => {
			requests.call(0).answer({ error: { code: 'x', message: 'x' } }, 500)

			expect(loader.view).toMatchObject({
				rows: first,
				filters: noFilters,
				nextCursor: 'page-2',
				isLoading: false,
			})
			expect(failures).toEqual(['failed'])
		})

		it('reports a 401 for the sign-in page', () => {
			requests.call(0).answer({ error: { code: 'x', message: 'x' } }, 401)

			expect(failures).toEqual(['unauthorized'])
		})
	})

	describe('racing first pages', () => {
		let kaf: NoteRow[]
		let kafka: NoteRow[]

		beforeEach(() => {
			kaf = listedNoteFactory.buildList(2)
			kafka = listedNoteFactory.buildList(1)
			loader.typeQuery('kaf')
			jest.advanceTimersByTime(queryDebounceMs)
			loader.typeQuery('kafka')
			jest.advanceTimersByTime(queryDebounceMs)
		})

		it('aborts the older request', () => {
			expect(requests.calls.map(({ signal }) => signal?.aborted)).toEqual([true, false])
		})

		it('never lets the answer for "kaf" win after "kafka"', () => {
			requests.call(1).answer(notesPageFactory.build({ notes: kafka, total: 1 }))
			requests.call(0).answer(notesPageFactory.build({ notes: kaf, total: 2 }))

			expect(loader.view).toMatchObject({ rows: kafka, total: 1, filters: { q: 'kafka' } })
		})

		it('drops an answer that arrived although its request was aborted', () => {
			requests.call(0).answer(notesPageFactory.build({ notes: kaf, total: 2 }))

			expect(loader.view).toMatchObject({ rows: first, isLoading: true })
			expect(failures).toEqual([])
		})
	})

	describe('loading more', () => {
		it('appends the next page without the rows already shown', () => {
			const next = listedNoteFactory.buildList(2)

			loader.loadMore()
			requests.call(0).answer(notesPageFactory.build({ notes: [first[2], ...next] }))

			expect(searchOf(requests.call(0).url)).toEqual({ cursor: 'page-2' })
			expect(ids(loader.view.rows)).toEqual(ids([...first, ...next]))
			expect(loader.view).toMatchObject({ nextCursor: null, isLoadingMore: false })
		})

		it('sends one request at a time', () => {
			loader.loadMore()
			loader.loadMore()

			expect(requests.calls).toHaveLength(1)
		})

		it('stops after the last page', () => {
			start(noFilters, null)
			loader.loadMore()

			expect(requests.calls).toHaveLength(0)
		})

		it('drops the page when the filters change before it arrives', () => {
			const filtered = listedNoteFactory.buildList(1, { status: 'read' })

			loader.loadMore()
			loader.setFilters({ status: 'read' })
			requests.call(0).answer(notesPageFactory.build({ notes: listedNoteFactory.buildList(2) }))

			expect(requests.call(0).signal?.aborted).toBe(true)
			expect(loader.view.rows).toEqual(first)

			requests.call(1).answer(notesPageFactory.build({ notes: filtered }))

			expect(loader.view.rows).toEqual(filtered)
		})

		it('keeps the cursor when a page fails, so it can be asked again', () => {
			loader.loadMore()
			requests.call(0).fail(new TypeError('Load failed'))

			expect(loader.view).toMatchObject({ nextCursor: 'page-2', isLoadingMore: false })
			expect(failures).toEqual(['failed'])
		})
	})

	describe('reload', () => {
		it('asks for the first page with the current filters and keeps the rows meanwhile', () => {
			start({ status: 'ready', categoryId: 1, q: 'kafka' })
			loader.reload()

			expect(searchOf(requests.call(0).url)).toEqual({
				status: 'ready',
				categoryId: '1',
				q: 'kafka',
			})
			expect(loader.view).toMatchObject({ rows: first, isLoading: true })
		})
	})

	describe('stop', () => {
		it('lets no pending search fire', () => {
			loader.typeQuery('kafka')
			loader.stop()
			jest.advanceTimersByTime(queryDebounceMs)

			expect(requests.calls).toHaveLength(0)
		})
	})
})
