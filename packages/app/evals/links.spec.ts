// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { serve } from 'bun'
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'

import { checkLinks, ipv6Hextets, isPublicAddress, type Fetch } from './links'

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
	describe('isPublicAddress', () => {
		it.each([
			'127.0.0.1',
			'10.1.2.3',
			'172.20.0.1',
			'192.168.1.1',
			'169.254.169.254',
			'100.100.1.1',
			'0.0.0.0',
			'::',
			'::1',
			'::7f00:1',
			'::ffff:127.0.0.1',
			'::ffff:7f00:1',
			'[::ffff:7f00:1]',
			'::ffff:a00:1',
			'::ffff:8.8.8.8',
			'64:ff9b::7f00:1',
			'64:ff9b::8.8.8.8',
			'2002:7f00:1::1',
			'2002:a00:1::',
			'fd00::1',
			'fe80::1',
			'fec0::1',
			'ff02::1',
			'fe80::1%eth0',
			'1::2::3',
			'::ffff:999.0.0.1',
			'localhost',
		])('refuses %p', (address) => {
			expect(isPublicAddress(address)).toBe(false)
		})

		it.each(['93.184.215.14', '172.32.0.1', '2606:4700::1111', '2002:5db8:d70e::1'])(
			'allows %p',
			(address) => {
				expect(isPublicAddress(address)).toBe(true)
			},
		)
	})

	describe('ipv6Hextets', () => {
		it.each([
			['::ffff:127.0.0.1', [0, 0, 0, 0, 0, 0xff_ff, 0x7f_00, 1]],
			['2606:4700::1111', [0x26_06, 0x47_00, 0, 0, 0, 0, 0, 0x11_11]],
			['1:2:3:4:5:6:7:8', [1, 2, 3, 4, 5, 6, 7, 8]],
		])('expands %p', (address, hextets) => {
			expect(ipv6Hextets(address)).toEqual(hextets)
		})

		it.each(['1:2:3', '1:2:3:4:5:6:7:8::', 'g::1'])('rejects %p', (address) => {
			expect(ipv6Hextets(address)).toBeNull()
		})
	})

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
