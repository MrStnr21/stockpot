// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { afterEach, beforeEach, describe, expect, it, jest } from 'bun:test'
import { listedNoteFactory, notesPageFactory } from '#tests/factories/listed-notes'
import { NotesFetch } from '#tests/setup/notes-fetch'

import type { BaseOverview, NoteRow } from '../shared/types'
import { createBaseApi } from './base-api'
import { BaseController } from './base-controller.svelte'
import { queryDebounceMs } from './list-loader'

const loadFailedToast = 'Couldn’t reach your server.'

function ids(rows: readonly NoteRow[]) {
	return rows.map(({ id }) => id)
}

function searchOf(url: string) {
	return Object.fromEntries(new URL(url, 'http://stockpot.test').searchParams)
}

function page(notes: readonly NoteRow[], nextCursor: string | null = null) {
	return notesPageFactory.build({ notes: [...notes], nextCursor, total: notes.length })
}

describe('BaseController', () => {
	let requests: NotesFetch
	let signIns: number
	let tech: NoteRow[]
	let loose: NoteRow[]
	let overview: BaseOverview
	let controller: BaseController

	function start(initial: BaseOverview = overview) {
		controller = new BaseController({
			initial,
			api: createBaseApi({ fetch: requests.fetch }),
			strings: { loadFailedToast },
			signIn: () => {
				signIns += 1
			},
		})
	}

	function search(text: string) {
		controller.typeQuery(text)
		jest.advanceTimersByTime(queryDebounceMs)
	}

	beforeEach(() => {
		jest.useFakeTimers()
		requests = new NotesFetch()
		signIns = 0
		tech = listedNoteFactory.buildList(3, { categoryId: 2 })
		loose = [listedNoteFactory.build({ categoryId: null })]
		overview = {
			total: 6,
			groups: [
				{ categoryId: 2, count: 5, notes: tech },
				{ categoryId: null, count: 1, notes: loose },
			],
		}
		start()
	})

	afterEach(() => {
		controller.destroy()
		jest.useRealTimers()
	})

	describe('the overview', () => {
		it('draws every group’s preview in order, with nothing loading', () => {
			expect([ids(controller.drawnRows), controller.empty, requests.calls.length]).toEqual([
				[...ids(tech), ...ids(loose)],
				null,
				0,
			])
		})

		it('shows the empty Base when nothing is kept', () => {
			controller.destroy()
			start({ total: 0, groups: [] })

			expect(controller.empty).toBe('base')
		})
	})

	describe('searching', () => {
		it('searches only after a pause in typing', () => {
			controller.typeQuery('ru')
			jest.advanceTimersByTime(queryDebounceMs - 1)
			controller.typeQuery('run')
			jest.advanceTimersByTime(queryDebounceMs - 1)

			expect(requests.calls).toHaveLength(0)

			jest.advanceTimersByTime(1)

			expect(requests.calls.map(({ url }) => searchOf(url))).toEqual([{ q: 'run' }])
		})

		it('shows the results in place of the groups once they answer', () => {
			search('run')

			expect(ids(controller.drawnRows)).toEqual([...ids(tech), ...ids(loose)])

			requests.call(0).answer(page([tech[1]]))

			expect([controller.showsSearch, ids(controller.drawnRows), controller.search?.total]).toEqual(
				[true, [tech[1].id], 1],
			)
		})

		it('drops the answer to an older search that arrives last', () => {
			search('ru')
			search('run')
			requests.call(1).answer(page([tech[0]]))
			requests.call(0).answer(page(loose))

			expect([ids(controller.drawnRows), requests.call(0).signal?.aborted]).toEqual([
				[tech[0].id],
				true,
			])
		})

		it('clears the search at once for a blank field, aborting the one on its way', () => {
			search('run')
			controller.typeQuery('  ')
			requests.call(0).answer(page([tech[0]]))

			expect([controller.search, requests.call(0).signal?.aborted, requests.calls.length]).toEqual([
				null,
				true,
				1,
			])
		})

		it('shows no results for a settled search that found nothing, until it is cleared', () => {
			search('kubernets')
			requests.call(0).answer(page([]))

			const { empty } = controller

			controller.clearSearch()

			expect([empty, controller.empty, controller.query]).toEqual(['search', null, ''])
		})

		it('loads more results after the ones shown', () => {
			search('run')
			requests.call(0).answer(page([tech[0]], 'next'))
			controller.loadMoreResults().catch(() => null)
			requests.call(1).answer(page([tech[0], tech[1]]))

			expect([searchOf(requests.call(1).url), ids(controller.drawnRows)]).toEqual([
				{ q: 'run', cursor: 'next' },
				[tech[0].id, tech[1].id],
			])
		})
	})

	describe('a group in full', () => {
		it('shows its first page in place of the preview, then more', () => {
			const more = listedNoteFactory.buildList(2, { categoryId: 2 })

			controller.showAll(2).catch(() => null)
			requests.call(0).answer(page(tech, 'next'))
			controller.loadMoreIn(2).catch(() => null)
			requests.call(1).answer(page(more))

			expect([
				requests.calls.map(({ url }) => searchOf(url)),
				ids(controller.rowsOf(2)),
				controller.expanded.get(2)?.nextCursor,
			]).toEqual([
				[{ categoryId: '2' }, { categoryId: '2', cursor: 'next' }],
				ids([...tech, ...more]),
				null,
			])
		})

		it('goes back to the preview and ignores the page on its way', () => {
			controller.showAll('none').catch(() => null)
			controller.showLess('none')
			requests.call(0).answer(page([listedNoteFactory.build({ categoryId: null }), ...loose]))

			expect([controller.expanded.size, ids(controller.rowsOf(null))]).toEqual([0, ids(loose)])
		})
	})

	describe('reload', () => {
		it('loads the overview, the search and each expanded group’s first page again', () => {
			const more = listedNoteFactory.buildList(2, { categoryId: 2 })

			controller.showAll(2).catch(() => null)
			requests.call(0).answer(page(tech, 'next'))
			controller.loadMoreIn(2).catch(() => null)
			requests.call(1).answer(page(more))
			search('run')
			requests.call(2).answer(page([tech[0]]))

			controller.reload().catch(() => null)
			requests.last('/api/base').respond(Response.json({ ...overview, total: 5 }))
			requests.call(4).answer(page([tech[1]]))
			requests.call(5).answer(page(tech.slice(1), 'again'))

			expect([
				requests.calls.slice(3).map(({ url }) => url),
				controller.overview.total,
				ids(controller.search?.rows ?? []),
				ids(controller.rowsOf(2)),
			]).toEqual([
				['/api/base', '/api/base/notes?q=run', '/api/base/notes?categoryId=2'],
				5,
				[tech[1].id],
				ids(tech.slice(1)),
			])
		})

		it('lets a newer search win over the search a reload sent', () => {
			search('run')
			requests.call(0).answer(page([tech[0]]))
			controller.reload().catch(() => null)
			search('bun')
			requests.last('/api/base/notes').answer(page([tech[2]]))
			requests.call(2).answer(page([tech[1]]))

			expect([controller.search?.query, ids(controller.drawnRows)]).toEqual(['bun', [tech[2].id]])
		})

		it('stops showing a group that has nothing kept any more', () => {
			controller.showAll('none').catch(() => null)
			controller.reload().catch(() => null)
			requests.last('/api/base').respond(Response.json({ total: 5, groups: [overview.groups[0]] }))

			expect([controller.expanded.size, requests.call(0).signal?.aborted]).toEqual([0, true])
		})
	})

	describe('failures', () => {
		it('sends a signed-out visitor to sign in', () => {
			controller.reload().catch(() => null)
			requests.call(0).answer({ error: { code: 'unauthorized', message: 'x' } }, 401)

			expect([signIns, controller.toasts.current]).toEqual([1, null])
		})

		it('says the server is out of reach and keeps the rows', () => {
			search('run')
			requests.call(0).answer(page([tech[0]]))
			search('bun')
			requests.call(1).fail(new TypeError('offline'))

			expect([
				controller.toasts.current?.title,
				ids(controller.drawnRows),
				controller.search?.isLoading,
			]).toEqual([loadFailedToast, [tech[0].id], false])
		})
	})
})
