// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { describe, expect, it } from 'bun:test'

import {
	filtersSearch,
	filtersToParams,
	noFilters,
	normalizeQuery,
	pageSearch,
	readFilters,
	rowMatchesFilters,
	sameFilters,
	type NoteFilters,
} from './filters'

const categoryIds = [1, 2, 7]

describe('notes filters', () => {
	describe('readFilters', () => {
		it.each<[string, NoteFilters]>([
			['', noFilters],
			['?status=ready', { status: 'ready', categoryId: null, q: '' }],
			['?categoryId=7', { status: null, categoryId: 7, q: '' }],
			['?q=%20event%20drive%20', { status: null, categoryId: null, q: 'event drive' }],
			['?status=failed&categoryId=2&q=kafka', { status: 'failed', categoryId: 2, q: 'kafka' }],
		])('reads %s', (search, filters) => {
			expect(readFilters(new URLSearchParams(search), categoryIds)).toEqual(filters)
		})

		it.each<[string, string, Partial<NoteFilters>]>([
			['an unknown status', '?status=deleted&categoryId=2', { categoryId: 2 }],
			['a category the instance lacks', '?categoryId=3&q=kafka', { q: 'kafka' }],
			['a category that is not a row id', '?categoryId=02&status=new', { status: 'new' }],
			['a negative category', '?categoryId=-1', {}],
			['a search over 200 characters', `?q=${'a'.repeat(201)}&status=read`, { status: 'read' }],
		])('drops %s and keeps the rest', (_name, search, kept) => {
			expect(readFilters(new URLSearchParams(search), categoryIds)).toEqual({
				...noFilters,
				...kept,
			})
		})

		it('counts the search in characters a person sees', () => {
			const q = '👍🏽'.repeat(200)

			expect(readFilters(new URLSearchParams({ q }), categoryIds).q).toBe(q)
		})
	})

	describe('the URL round trip', () => {
		it.each<NoteFilters>([
			noFilters,
			{ status: 'archived', categoryId: null, q: '' },
			{ status: null, categoryId: 7, q: 'a & b = "c"' },
			{ status: 'new', categoryId: 1, q: 'кафка?' },
		])('reads back what it writes for %o', (filters) => {
			const search = filtersSearch(filters)

			expect(readFilters(new URLSearchParams(search), categoryIds)).toEqual(filters)
		})

		it('leaves empty filters out of the URL', () => {
			expect(filtersSearch(noFilters)).toBe('')
			expect([...filtersToParams({ ...noFilters, status: 'new' }).keys()]).toEqual(['status'])
		})
	})

	describe('pageSearch', () => {
		it('adds the cursor to the filters', () => {
			expect(pageSearch({ status: 'new', categoryId: 2, q: 'x' }, 'MTcwMC4z')).toBe(
				'?status=new&categoryId=2&q=x&cursor=MTcwMC4z',
			)
		})

		it('is empty for the first page of every note', () => {
			expect(pageSearch(noFilters, null)).toBe('')
		})
	})

	describe('rowMatchesFilters', () => {
		it.each([
			[{ status: 'new', categoryId: 1 }, noFilters, true],
			[{ status: 'archived', categoryId: 1 }, { ...noFilters, status: 'new' }, false],
			[{ status: 'new', categoryId: 2 }, { ...noFilters, categoryId: 1 }, false],
			[{ status: 'new', categoryId: null }, { ...noFilters, categoryId: 1 }, false],
			[{ status: 'new', categoryId: 1 }, { status: 'new', categoryId: 1, q: 'zzz' }, true],
		] as const)('judges %o under %o as %p, never by the search', (row, filters, matches) => {
			expect(rowMatchesFilters(row, filters)).toBe(matches)
		})
	})

	describe('sameFilters and normalizeQuery', () => {
		it('compares every field', () => {
			expect(sameFilters(noFilters, { ...noFilters })).toBe(true)
			expect(sameFilters(noFilters, { ...noFilters, q: 'a' })).toBe(false)
		})

		it('trims the search', () => {
			expect(normalizeQuery('  kafka \n')).toBe('kafka')
		})
	})
})
