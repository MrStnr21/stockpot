// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { afterEach, beforeEach, describe, expect, it, jest } from 'bun:test'
import { listedNoteFactory, notesPageFactory } from '#tests/factories/listed-notes'
import { NotesFetch } from '#tests/setup/notes-fetch'

import { noFilters, type NoteFilters } from '../shared/filters'
import type { NoteRow } from '../shared/types'
import { ListLoader, type ListFailure } from './list-loader'
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

	describe('a bulk request on its way', () => {
		it('aborts the page in flight and asks for it again on release', () => {
			loader.loadMore()
			loader.hold()
			requests.call(0).answer(notesPageFactory.build({ notes: listedNoteFactory.buildList(1) }))

			expect(requests.call(0).signal?.aborted).toBe(true)
			expect(loader.view).toMatchObject({ rows: first, isLoadingMore: false })

			loader.release()

			expect(requests.calls.map(({ url }) => searchOf(url))).toEqual([
				{ cursor: 'page-2' },
				{ cursor: 'page-2' },
			])
		})

		it('holds a page asked for meanwhile until release', () => {
			loader.hold()
			loader.loadMore()

			expect(requests.calls).toHaveLength(0)

			loader.release()

			expect(requests.calls).toHaveLength(1)
		})
	})

	describe('bulk patches', () => {
		it('patches and drops loaded rows without touching the cursor', () => {
			start({ ...noFilters, status: 'new' })
			loader.applyPatches(
				new Map([
					[first[0].id, { kind: 'set', status: 'archived' }],
					[first[1].id, { kind: 'set', categoryId: 4 }],
					[first[2].id, { kind: 'remove' }],
				]),
			)

			expect(loader.view.rows).toEqual([{ ...first[1], categoryId: 4 }])
			expect(loader.view.nextCursor).toBe('page-2')
		})

		it('lets no list answer sent before a bulk answer undo it', () => {
			const [archived, gone, kept] = first

			loader.reload()
			loader.applyPatches(
				new Map([
					[archived.id, { kind: 'set', status: 'archived' }],
					[gone.id, { kind: 'remove' }],
				]),
			)
			requests.call(0).answer(notesPageFactory.build({ notes: first }))

			expect(loader.view.rows).toEqual([{ ...archived, status: 'archived' }, kept])
		})

		it('merges a page sent before the bulk answer through the patches too', () => {
			const next = listedNoteFactory.buildList(2)

			loader.loadMore()
			loader.applyPatches(new Map([[next[0].id, { kind: 'set', status: 'queued' }]]))
			requests.call(0).answer(notesPageFactory.build({ notes: next }))

			expect(loader.view.rows.slice(-2)).toEqual([{ ...next[0], status: 'queued' }, next[1]])
		})

		it('drops the patches once a first page sent after them arrives', () => {
			const [note] = first

			loader.applyPatches(new Map([[note.id, { kind: 'set', status: 'archived' }]]))
			loader.reload()
			requests.call(0).answer(notesPageFactory.build({ notes: [note] }))
			loader.loadMore()

			expect(loader.view.rows).toEqual([note])

			loader.reload()
			requests.call(1).answer(notesPageFactory.build({ notes: [note] }))

			expect(loader.view.rows).toEqual([note])
		})

		it('drops a patched row from an earlier answer when it left the filter', () => {
			start({ ...noFilters, status: 'new' })
			loader.reload()
			loader.applyPatches(new Map([[first[0].id, { kind: 'set', status: 'archived' }]]))
			requests.call(0).answer(notesPageFactory.build({ notes: first }))

			expect(ids(loader.view.rows)).toEqual(ids(first.slice(1)))
		})
	})
})
