// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { describe, expect, it } from 'bun:test'
import { listedNoteFactory, notesPageFactory } from '#tests/factories/listed-notes'

import type { BaseOverview, NoteRow } from '../shared/types'
import {
	appended,
	baseEmpty,
	drawnRows,
	searchAnswered,
	searchStarted,
	type BaseSearch,
	type ExpandedGroups,
} from './base-state'

function ids(rows: readonly NoteRow[]) {
	return rows.map(({ id }) => id)
}

describe('base state', () => {
	const tech = listedNoteFactory.buildList(3, { categoryId: 2 })
	const loose = [listedNoteFactory.build({ categoryId: null })]

	const overview: BaseOverview = {
		total: 6,
		groups: [
			{ categoryId: 2, count: 5, notes: tech },
			{ categoryId: null, count: 1, notes: loose },
		],
	}

	const answered: BaseSearch = {
		query: 'run',
		rows: [tech[0]],
		total: 1,
		nextCursor: null,
		isLoading: false,
		isLoadingMore: false,
	}

	it('appends only the rows not shown yet', () => {
		const rows = appended(tech.slice(0, 2), tech.slice(1))

		expect(ids(rows)).toEqual(ids(tech))
	})

	it('keeps the rows on screen while a new search loads, without a next page', () => {
		const started = searchStarted({ ...answered, nextCursor: 'next' }, 'bun')

		expect(started).toEqual({ ...answered, query: 'bun', isLoading: true })
	})

	it('replaces the rows with a first page and adds a later one after them', () => {
		const first = notesPageFactory.build({ notes: [tech[1]], nextCursor: 'next', total: 2 })
		const more = notesPageFactory.build({ notes: [tech[2]], total: 2 })

		const shown = searchAnswered(answered, first, false)

		expect([ids(shown.rows), ids(searchAnswered(shown, more, true).rows)]).toEqual([
			[tech[1].id],
			[tech[1].id, tech[2].id],
		])
	})

	it('draws the groups, with an expanded group’s pages, until a search answers', () => {
		const expanded: ExpandedGroups = new Map([
			[2, { rows: [...tech, ...tech], nextCursor: null, isLoading: false }],
		])

		const loading = searchStarted(null, 'run')

		expect([
			ids(drawnRows(overview, expanded, loading)),
			ids(drawnRows(overview, expanded, answered)),
		]).toEqual([[...ids(tech), ...ids(tech), ...ids(loose)], [tech[0].id]])
	})

	it('tells an empty Base from a search that found nothing', () => {
		const empty = { total: 0, groups: [] }
		const nothing = { ...answered, rows: [], total: 0 }

		expect([
			baseEmpty(empty, null),
			baseEmpty(overview, null),
			baseEmpty(overview, nothing),
			baseEmpty(overview, { ...nothing, isLoading: true }),
		]).toEqual(['base', null, 'search', null])
	})
})
