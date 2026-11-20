// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { describe, expect, it } from 'bun:test'

import { openLink } from './open-link'

const site = 'https://example.com/'

const ipv4 = '93.184.215.14'

const ipv6 = '2606:4700:4700::1111'

async function lookup() {
	return [ipv4]
}

describe('openLink', () => {
	describe('before connecting', () => {
		it.each([
			'not a URL',
			'ftp://example.com/',
			'https://user@example.com/',
			'https://:pass@example.com/',
			'http://192.168.1.10/',
			'http://127.0.0.1/',
			'http://0x7f.1/',
			'http://2130706433/',
			'http://[::ffff:127.0.0.1]/',
			'http://[::ffff:7f00:1]/',
			'http://[::7f00:1]/',
			'http://[64:ff9b::7f00:1]/',
		])('refuses %p without DNS or a request', async (url) => {
			const calls: string[] = []

			const outcome = await openLink(url, {
				lookup: async (hostname) => {
					calls.push(hostname)

					return [ipv4]
				},
				fetch: async (target) => {
					calls.push(target)

					return new Response(null)
				},
			})

			expect({ outcome, calls }).toMatchObject({ outcome: { kind: 'refused' }, calls: [] })
		})

		it.each(['192.168.1.10', 'another.example', `[${ipv4}]`])(
			'refuses the whole lookup when it includes %p',
			async (answer) => {
				const calls: string[] = []

				const outcome = await openLink(site, {
					lookup: async () => [ipv4, answer],
					fetch: async (target) => {
						calls.push(target)

						return new Response(null)
					},
				})

				expect({ outcome, calls }).toMatchObject({ outcome: { kind: 'refused' }, calls: [] })
			},
		)

		it('reports an empty lookup as dead', async () => {
			const outcome = await openLink(site, {
				lookup: async () => [],
				fetch: async () => new Response(null),
			})

			expect(outcome).toEqual({ kind: 'dead', reason: 'no addresses' })
		})
	})

	describe('pinned requests', () => {
		it('resolves once per hop and uses the checked IP for HEAD and GET with the original authority', async () => {
			const names: string[] = []
			const requests: unknown[] = []

			const outcome = await openLink('https://example.com:8443/path?q=1#fragment', {
				lookup: async (name) => {
					names.push(name)

					return names.length === 1 ? [ipv4] : ['127.0.0.1']
				},
				fetch: async (url, init) => {
					requests.push({ url, init })

					return new Response(null, { status: init.method === 'HEAD' ? 405 : 200 })
				},
			})

			const url = `https://${ipv4}:8443/path?q=1`

			const init = {
				headers: { Host: 'example.com:8443' },
				tls: { serverName: 'example.com' },
				redirect: 'manual',
			}

			expect({ outcome, names, requests }).toMatchObject({
				outcome: { kind: 'open', status: 200 },
				names: ['example.com'],
				requests: [
					{ url, init: { ...init, method: 'HEAD' } },
					{ url, init: { ...init, method: 'GET' } },
				],
			})
		})

		it.each([ipv4, `[${ipv6}]`])(
			'opens literal %p without DNS or a TLS name override',
			async (host) => {
				const calls: unknown[] = []

				const outcome = await openLink(`https://${host}/`, {
					lookup: async (hostname) => {
						calls.push(hostname)

						return []
					},
					fetch: async (url, init) => {
						calls.push([url, init.headers, init.tls])

						return new Response(null)
					},
				})

				expect({ outcome, calls }).toEqual({
					outcome: { kind: 'open', status: 200 },
					calls: [[`https://${host}/`, { Host: host }, undefined]],
				})
			},
		)

		it('tries IPv4 before IPv6 in DNS order until an address answers', async () => {
			const urls: string[] = []

			const outcome = await openLink(site, {
				lookup: async () => [
					'2606:4700:4700:0:0:0:0:1111',
					ipv4,
					'1.1.1.1',
					'2606:4700:4700::1001',
				],
				fetch: async (url) => {
					urls.push(url)

					if (url.includes('[')) {
						return new Response(null, { status: 500 })
					}

					throw new Error('connection failed')
				},
			})

			expect({ outcome, urls }).toEqual({
				outcome: { kind: 'dead', reason: 'status 500' },
				urls: [`https://${ipv4}/`, 'https://1.1.1.1/', `https://[${ipv6}]/`],
			})
		})
	})

	describe('deadline and cancellation', () => {
		it.each(['DNS', 'GET'])('returns timed out when %p never settles', async (stage) => {
			const outcome = await openLink(site, {
				timeoutMs: 20,
				lookup: stage === 'DNS' ? async () => Promise.withResolvers<string[]>().promise : lookup,
				fetch: async (_url, init) =>
					init.method === 'HEAD'
						? new Response(null, { status: 405 })
						: Promise.withResolvers<Response>().promise,
			})

			expect(outcome).toEqual({ kind: 'dead', reason: 'timed out' })
		})

		it('shares one deadline across addresses, redirects and the GET fallback', async () => {
			const signals = new Set<AbortSignal | null | undefined>()
			let calls = 0

			async function fetch(_url: string, init: BunFetchRequestInit) {
				signals.add(init.signal)
				calls += 1

				if (calls === 1) {
					throw new Error('connection failed')
				}

				if (calls === 2) {
					return new Response(null, { status: 302, headers: { Location: '/next' } })
				}

				return new Response(null, { status: init.method === 'HEAD' ? 405 : 200 })
			}

			const outcome = await openLink(site, { lookup: async () => [ipv4, '1.1.1.1'], fetch })

			expect([outcome.kind, calls, signals.size]).toEqual(['open', 4, 1])
		})

		it('rejects with the caller’s reason while a request is pending', async () => {
			const controller = new AbortController()
			const reason = new Error('stopped')
			const started = Promise.withResolvers<null>()

			const outcome = openLink(site, {
				signal: controller.signal,
				lookup,
				fetch: async () => {
					started.resolve(null)

					return Promise.withResolvers<Response>().promise
				},
			})

			await started.promise
			controller.abort(reason)

			expect(outcome).rejects.toBe(reason)
		})
	})
})
