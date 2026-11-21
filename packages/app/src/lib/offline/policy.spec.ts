// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { describe, expect, it } from 'bun:test'

import {
	assetCacheOrder,
	classifyRequest,
	isStorablePage,
	isUnreachable,
	markOffline,
	referencedAssets,
	staleAssetCaches,
	type RequestFacts,
	type RequestKind,
	type ResponseFacts,
} from './policy'

const origin = 'https://stockpot.example'

const precached = new Set(['/_astro/app.css', '/offline'])

function request(path: string, overrides: Partial<RequestFacts> = {}): RequestFacts {
	return {
		method: 'GET',
		mode: 'navigate',
		destination: 'document',
		url: `${origin}${path}`,
		...overrides,
	}
}

function response(overrides: Partial<ResponseFacts> = {}): ResponseFacts {
	return {
		ok: true,
		status: 200,
		redirected: false,
		type: 'basic',
		headers: new Headers({ 'content-type': 'text/html; charset=utf-8' }),
		...overrides,
	}
}

describe('the offline policy', () => {
	describe('classifyRequest', () => {
		const navigations: [string, RequestKind][] = [
			['/', 'stored-page'],
			['/notes', 'stored-page'],
			['/base', 'navigation'],
			['/settings', 'navigation'],
			['/notes?page=2', 'navigation'],
			['/notes/', 'navigation'],
			['/_astro/app.css', 'asset'],
			['/_astro/old-build.css', 'asset'],
			['/offline', 'asset'],
		]

		it.each(navigations)('treats a navigation to %s as %s', (path, kind) => {
			expect(classifyRequest(request(path), origin, precached)).toBe(kind)
		})

		it('treats a navigation POST to /signout as sign-out', () => {
			const facts = request('/signout', { method: 'POST' })

			expect(classifyRequest(facts, origin, precached)).toBe('sign-out')
		})

		it.each([
			['a POST to another page', request('/notes', { method: 'POST' })],
			['an API call', request('/api/notes', { mode: 'cors', destination: '' })],
			['a fetch to Today', request('/', { mode: 'cors', destination: '' })],
			['a fetch POST to /signout', request('/signout', { method: 'POST', mode: 'cors' })],
			['a frame', request('/', { destination: 'iframe' })],
			['another origin', { ...request('/'), url: 'https://other.example/' }],
			[
				'an asset path on another origin',
				{ ...request('/_astro/app.css'), url: 'https://cdn.example/_astro/app.css' },
			],
		])('leaves %s to the network', (_name, facts) => {
			expect(classifyRequest(facts, origin, precached)).toBe('ignored')
		})

		it('serves a precached file requested as a subresource from the cache', () => {
			const facts = request('/_astro/app.css', { mode: 'no-cors', destination: 'style' })

			expect(classifyRequest(facts, origin, precached)).toBe('asset')
		})
	})

	describe('isStorablePage', () => {
		it('accepts a plain 200 HTML answer', () => {
			expect(isStorablePage(response())).toBe(true)
		})

		it.each([
			['a redirected answer', { redirected: true }],
			['an opaque redirect', { type: 'opaqueredirect' as const, ok: false, status: 0 }],
			['an opaque answer', { type: 'opaque' as const, ok: false, status: 0 }],
			['a cors answer', { type: 'cors' as const }],
			['a 404', { ok: false, status: 404 }],
			['a 500', { ok: false, status: 500 }],
			['a 204', { status: 204 }],
			['a JSON answer', { headers: new Headers({ 'content-type': 'application/json' }) }],
			['an answer without a type', { headers: new Headers() }],
		] as const)('refuses %s', (_name, overrides) => {
			expect(isStorablePage(response(overrides))).toBe(false)
		})
	})

	describe('referencedAssets', () => {
		it('lists each build file a page names once', () => {
			const page =
				'<link href="/_astro/a.css" rel="stylesheet"><script>import("/_astro/b.js?x=1")</script><img src="/_astro/a.css">'

			expect(referencedAssets(page)).toEqual(['/_astro/a.css', '/_astro/b.js'])
		})

		it('finds nothing in a page without build files', () => {
			expect(referencedAssets('<a href="/notes">Notes</a>')).toEqual([])
		})
	})

	describe('isUnreachable', () => {
		it.each([502, 503, 504])('takes %i for a stopped server behind a proxy', (status) => {
			expect(isUnreachable({ status })).toBe(true)
		})

		it.each([200, 301, 401, 404, 500])('takes %i for an answer', (status) => {
			expect(isUnreachable({ status })).toBe(false)
		})
	})

	describe('markOffline', () => {
		it('adds the attribute to the html tag only', () => {
			expect(markOffline('<!doctype html><html lang="en"><body><html-x></body></html>')).toBe(
				'<!doctype html><html data-connection="offline" lang="en"><body><html-x></body></html>',
			)
		})

		it('marks a tag without attributes', () => {
			expect(markOffline('<html><head></head></html>')).toBe(
				'<html data-connection="offline"><head></head></html>',
			)
		})

		it('leaves a page that carries the attribute alone', () => {
			const page = '<html data-connection="offline" lang="ru"><body></body></html>'

			expect(markOffline(page)).toBe(page)
		})

		it('leaves a body without an html tag alone', () => {
			expect(markOffline('plain text')).toBe('plain text')
		})
	})

	describe('staleAssetCaches', () => {
		const names = ['pages', 'assets-old', 'assets-new', 'other']

		it('lists the old builds once every page was renewed', () => {
			expect(staleAssetCaches(names, 'assets-new', true)).toEqual(['assets-old'])
		})

		it('lists nothing while a page could not be renewed', () => {
			expect(staleAssetCaches(names, 'assets-new', false)).toEqual([])
		})
	})

	describe('assetCacheOrder', () => {
		it('searches the current cache, then the others newest first', () => {
			const names = ['assets-a', 'pages', 'assets-b', 'assets-cur', 'assets-c']

			expect(assetCacheOrder(names, 'assets-cur')).toEqual([
				'assets-cur',
				'assets-c',
				'assets-b',
				'assets-a',
			])
		})
	})
})
