// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { serve } from 'bun'
import { describe, expect, it } from 'bun:test'

import { openLink } from './open-link'

const site = 'https://example.com/'

const ipv4 = '93.184.215.14'

async function lookup() {
	return [ipv4]
}

function redirect(location: string) {
	return new Response(null, { status: 302, headers: { Location: location } })
}

describe('openLink HTTP responses', () => {
	it('reads a local 404 and refuses a name pointing to the same server before it receives another request', async () => {
		let hits = 0

		using server = serve({
			hostname: '127.0.0.1',
			port: 0,
			fetch: () => {
				hits += 1

				return new Response(null, { status: 404 })
			},
		})

		const name = `http://localhost:${server.port}/page`
		const targets: string[] = []

		const gone = await openLink(name, {
			lookup,
			// Route only the test transport to the listener so the public-address policy stays active.
			fetch: async (url, init) => {
				targets.push(url)

				return fetch(server.url, init)
			},
		})

		const hitsBeforeRefusal = hits
		const refused = await openLink(name, { lookup: async () => ['127.0.0.1'] })

		expect({
			gone,
			targets,
			refused,
			additionalHits: hits - hitsBeforeRefusal,
			hits,
		}).toMatchObject({
			gone: { kind: 'dead', reason: 'status 404' },
			targets: [`http://${ipv4}:${server.port}/page`],
			refused: { kind: 'refused' },
			additionalHits: 0,
			hits: 1,
		})
	})

	describe('redirects', () => {
		it('resolves a relative Location against the name and checks its new DNS answer', async () => {
			const names: string[] = []
			const requests: string[] = []

			const outcome = await openLink(`${site}path/start`, {
				lookup: async (name) => {
					names.push(name)

					return names.length === 1 ? [ipv4] : ['127.0.0.1']
				},
				fetch: async (url) => {
					requests.push(url)

					return redirect('../page')
				},
			})

			expect({ outcome, names, requests }).toMatchObject({
				outcome: { kind: 'refused' },
				names: ['example.com', 'example.com'],
				requests: [`https://${ipv4}/path/start`],
			})
		})

		it.each(['http://127.0.0.1/', 'https://user@example.com/'])(
			'checks the redirect to %p before sending it',
			async (location) => {
				const urls: string[] = []

				const outcome = await openLink(site, {
					lookup,
					fetch: async (url) => {
						urls.push(url)

						return redirect(location)
					},
				})

				expect({ outcome, urls }).toMatchObject({
					outcome: { kind: 'refused' },
					urls: [`https://${ipv4}/`],
				})
			},
		)

		it.each([null, '', 'http://['])('reports an unusable Location %p as dead', async (location) => {
			const response = location === null ? new Response(null, { status: 302 }) : redirect(location)

			expect(await openLink(site, { lookup, fetch: async () => response })).toMatchObject({
				kind: 'dead',
			})
		})

		it.each([5, 6])('follows at most five of %p redirects', async (redirects) => {
			const urls: string[] = []

			const outcome = await openLink(site, {
				lookup,
				fetch: async (url) => {
					urls.push(url)

					return urls.length <= redirects ? redirect(`next-${urls.length}`) : new Response(null)
				},
			})

			expect([outcome.kind, urls.length, urls.at(-1)]).toEqual([
				redirects === 5 ? 'open' : 'dead',
				6,
				`https://${ipv4}/next-5`,
			])
		})
	})

	describe('HTTP responses', () => {
		it.each([
			[400, 204],
			[403, 403],
			[405, 200],
			[501, 429],
			[401, 401],
			[429, 429],
		])('treats HEAD %p ending in %p as open', async (head, status) => {
			const methods: (string | undefined)[] = []

			const outcome = await openLink(site, {
				lookup,
				fetch: async (_url, init) => {
					methods.push(init.method)

					return new Response(null, { status: init.method === 'HEAD' ? head : status })
				},
			})

			expect({ outcome, methods }).toEqual({
				outcome: { kind: 'open', status },
				methods: head === 401 || head === 429 ? ['HEAD'] : ['HEAD', 'GET'],
			})
		})

		it('cancels every body without waiting for an endless GET stream', async () => {
			const cancelled: string[] = []
			const stages = ['redirect', 'head', 'get']

			const outcome = await openLink(site, {
				lookup,
				fetch: async () => {
					const stage = stages.shift() ?? ''

					const body = new ReadableStream({
						async cancel() {
							cancelled.push(stage)

							return Promise.withResolvers<never>().promise
						},
					})

					if (stage === 'redirect') {
						return new Response(body, { status: 302, headers: { Location: '/next' } })
					}

					return new Response(body, { status: stage === 'head' ? 405 : 200 })
				},
			})

			expect({ outcome, cancelled }).toEqual({
				outcome: { kind: 'open', status: 200 },
				cancelled: ['redirect', 'head', 'get'],
			})
		}, 1000)
	})
})
