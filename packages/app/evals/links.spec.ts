// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { serve } from 'bun'
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'

import { checkLinks, type Fetch } from './links'

async function publicLookup(): Promise<string[]> {
	return ['93.184.215.14']
}

async function privateLookup(): Promise<string[]> {
	return ['10.0.0.5']
}

async function refuseHead(_url: string, init: RequestInit): Promise<Response> {
	return new Response(null, { status: init.method === 'HEAD' ? 405 : 200 })
}

function respond(routes: Record<string, Response | Error>): Fetch {
	const byUrl = new Map(Object.entries(routes))

	return async (url) => {
		const route = byUrl.get(url)

		if (route instanceof Error) {
			throw route
		}

		return route?.clone() ?? new Response(null, { status: 404 })
	}
}

describe('the link check', () => {
	describe('against a server on this machine', () => {
		let hits = 0
		const server = serve({ hostname: '127.0.0.1', port: 0, fetch: countHit })

		function countHit(): Response {
			hits += 1

			return new Response('secret')
		}

		beforeAll(() => {
			hits = 0
		})

		afterAll(async () => {
			await server.stop(true)
		})

		it.each([
			'http://127.0.0.1:{port}/',
			'http://localhost:{port}/',
			'http://[::ffff:127.0.0.1]:{port}/',
			'http://[::ffff:7f00:1]:{port}/',
			'http://[::7f00:1]:{port}/',
			'http://[64:ff9b::7f00:1]:{port}/',
		])('never sends a request to %p', async (template) => {
			const link = template.replace('{port}', String(server.port))
			const result = await checkLinks([link])

			expect(result?.passed).toBe(false)
			expect(hits).toBe(0)
		})
	})

	describe('checkLinks', () => {
		it('does not apply to a card without links', async () => {
			expect(await checkLinks([])).toBeNull()
		})

		it('passes links that answer', async () => {
			const fetch = respond({ 'https://example.com/': new Response(null, { status: 200 }) })

			expect(await checkLinks(['https://example.com/'], { lookup: publicLookup, fetch })).toEqual({
				check: 'links',
				passed: true,
				detail: null,
			})
		})

		it('falls back to GET when HEAD is refused', async () => {
			const result = await checkLinks(['https://example.com/'], {
				lookup: publicLookup,
				fetch: refuseHead,
			})

			expect(result).toMatchObject({ passed: true })
		})

		it('refuses a host that resolves to a private address', async () => {
			const fetch = respond({ 'https://internal.example/': new Response(null, { status: 200 }) })

			const result = await checkLinks(['https://internal.example/'], {
				lookup: privateLookup,
				fetch,
			})

			expect(result?.passed).toBe(false)
			expect(result?.detail).toContain('not a public')
		})

		it('refuses a redirect to a loopback address', async () => {
			const redirect = new Response(null, {
				status: 302,
				headers: { location: 'http://127.0.0.1/admin' },
			})

			const fetch = respond({ 'https://example.com/': redirect })
			const result = await checkLinks(['https://example.com/'], { lookup: publicLookup, fetch })

			expect(result?.passed).toBe(false)
			expect(result?.detail).toContain('127.0.0.1')
		})

		it('stops at the deadline while DNS is still resolving', async () => {
			const controller = new AbortController()
			let requests = 0

			const result = await checkLinks(['https://slow.example/'], {
				signal: controller.signal,
				lookup: async () => {
					controller.abort(new Error('deadline'))

					return Promise.withResolvers<string[]>().promise
				},
				fetch: async () => {
					requests += 1

					return new Response(null, { status: 200 })
				},
			})

			expect([result?.detail, requests]).toEqual(['https://slow.example/: deadline', 0])
		})

		it('keeps one deadline across the GET fallback', async () => {
			const controller = new AbortController()

			const result = await checkLinks(['https://example.com/'], {
				signal: controller.signal,
				lookup: publicLookup,
				fetch: async (_url, init) => {
					init.signal?.throwIfAborted()
					controller.abort(new Error('deadline'))

					return new Response(null, { status: 405 })
				},
			})

			expect(result?.detail).toBe('https://example.com/: deadline')
		})

		it('reports dead links and failed requests with the reason', async () => {
			const fetch = respond({ 'https://example.com/down': new Error('The operation timed out.') })
			const links = ['https://example.com/gone', 'https://example.com/down']
			const result = await checkLinks(links, { lookup: publicLookup, fetch })

			expect(result).toMatchObject({
				passed: false,
				detail:
					'https://example.com/gone: status 404; https://example.com/down: The operation timed out.',
			})
		})
	})
})
