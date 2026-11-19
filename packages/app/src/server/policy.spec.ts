// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { describe, expect, it } from 'bun:test'

import { isAllowed, isCrossSite, mayUseCookie } from './policy'

const publicOrigin = 'https://stockpot.example.ts.net'

function request(method: string, headers: Record<string, string>) {
	return new Request(`${publicOrigin}/api/notes`, { method, headers })
}

describe('policy', () => {
	describe('isCrossSite', () => {
		it.each([
			{ name: 'a GET from another site', method: 'GET', site: 'cross-site', refused: false },
			{ name: 'a POST marked same-origin', method: 'POST', site: 'same-origin', refused: false },
			{ name: 'a POST the owner started', method: 'POST', site: 'none', refused: false },
			{ name: 'a POST marked cross-site', method: 'POST', site: 'cross-site', refused: true },
			{
				name: 'a DELETE from a sibling subdomain',
				method: 'DELETE',
				site: 'same-site',
				refused: true,
			},
		])('judges $name by Sec-Fetch-Site', ({ method, site, refused }) => {
			expect(isCrossSite(request(method, { 'sec-fetch-site': site }), publicOrigin)).toBe(refused)
		})

		it.each([
			{
				name: 'a POST from the public origin',
				method: 'POST',
				origin: publicOrigin,
				refused: false,
			},
			{
				name: 'a PUT from another origin',
				method: 'PUT',
				origin: 'https://evil.example',
				refused: true,
			},
			{ name: 'a PATCH from an opaque origin', method: 'PATCH', origin: 'null', refused: true },
		])('judges $name by Origin when Sec-Fetch-Site is missing', ({ method, origin, refused }) => {
			expect(isCrossSite(request(method, { origin }), publicOrigin)).toBe(refused)
		})

		it('lets through a POST with neither header, as a client that is not a browser sends', () => {
			expect(isCrossSite(request('POST', {}), publicOrigin)).toBe(false)
		})

		it('trusts Sec-Fetch-Site over Origin', () => {
			const proxied = request('POST', {
				'sec-fetch-site': 'same-origin',
				origin: 'http://localhost:4321',
			})

			expect(isCrossSite(proxied, publicOrigin)).toBe(false)
		})
	})

	describe('isAllowed', () => {
		it('lets anyone through a public route', () => {
			expect(isAllowed('public', null)).toBe(true)
		})

		it('lets only the owner through an authorized route', () => {
			expect([
				isAllowed('authorized', null),
				isAllowed('authorized', { id: 1, via: 'session' }),
			]).toEqual([false, true])
		})
	})

	describe('mayUseCookie', () => {
		it.each<{ name: string; method: string; headers: Record<string, string>; counts: boolean }>([
			{ name: 'a GET with neither header', method: 'GET', headers: {}, counts: true },
			{
				name: 'a POST with Origin',
				method: 'POST',
				headers: { origin: publicOrigin },
				counts: true,
			},
			{
				name: 'a DELETE with Sec-Fetch-Site',
				method: 'DELETE',
				headers: { 'sec-fetch-site': 'same-origin' },
				counts: true,
			},
			{ name: 'a POST with neither header', method: 'POST', headers: {}, counts: false },
		])('judges the cookie on $name', ({ method, headers, counts }) => {
			expect(mayUseCookie(request(method, headers))).toBe(counts)
		})
	})
})
