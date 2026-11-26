// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { describe, expect, it } from 'bun:test'
import { countRowFactory } from '#tests/factories/listed-notes'

import { facetCounts } from './facets'

const counts = [
	countRowFactory.build({ categoryId: 1, status: 'new', count: 5 }),
	countRowFactory.build({ categoryId: 1, status: 'ready', count: 3 }),
	countRowFactory.build({ categoryId: 2, status: 'new', count: 2 }),
	countRowFactory.build({ categoryId: 2, status: 'archived', count: 4 }),
	countRowFactory.build({ categoryId: null, status: 'failed', count: 1 }),
]

describe('facetCounts', () => {
	it('counts everything without filters, in chip order', () => {
		const facets = facetCounts(counts, { status: null, categoryId: null })

		expect(facets).toMatchObject({ total: 15, all: 15, allCategories: 15 })
		expect(facets.statuses).toEqual([
			{ status: 'new', count: 7 },
			{ status: 'ready', count: 3 },
			{ status: 'failed', count: 1 },
			{ status: 'archived', count: 4 },
		])
		expect([...facets.categories]).toEqual([
			[1, 8],
			[2, 6],
		])
	})

	it('counts the status chips within the chosen category', () => {
		const facets = facetCounts(counts, { status: null, categoryId: 2 })

		expect(facets).toMatchObject({ total: 15, all: 6, allCategories: 15 })
		expect(facets.statuses).toEqual([
			{ status: 'new', count: 2 },
			{ status: 'archived', count: 4 },
		])
	})

	it('counts the categories within the chosen status', () => {
		const facets = facetCounts(counts, { status: 'new', categoryId: null })

		expect(facets).toMatchObject({ all: 15, allCategories: 7 })
		expect([...facets.categories]).toEqual([
			[1, 5],
			[2, 2],
		])
	})

	it('keeps the active status chip when nothing is in it', () => {
		const facets = facetCounts(counts, { status: 'queued', categoryId: 1 })

		expect(facets.statuses).toEqual([
			{ status: 'new', count: 5 },
			{ status: 'queued', count: 0 },
			{ status: 'ready', count: 3 },
		])
		expect(facets.allCategories).toBe(0)
	})

	it('counts notes without a category only in the totals', () => {
		const facets = facetCounts(counts, { status: 'failed', categoryId: null })

		expect(facets.allCategories).toBe(1)
		expect(facets.categories.size).toBe(0)
	})

	it('reads an empty instance as no notes at all', () => {
		expect(facetCounts([], { status: null, categoryId: null })).toEqual({
			total: 0,
			all: 0,
			statuses: [],
			allCategories: 0,
			categories: new Map(),
		})
	})
})
