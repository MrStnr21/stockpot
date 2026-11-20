// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { describe, expect, it } from 'bun:test'

import { checkLinks } from './links'

async function lookup() {
	return ['93.184.215.14']
}

describe('checkLinks', () => {
	it('does not apply to a card without links', async () => {
		expect(await checkLinks([])).toBeNull()
	})

	it('passes when every link answers, including a site that refuses automated requests', async () => {
		const result = await checkLinks(['https://example.com/', 'https://example.com/limited'], {
			lookup,
			fetch: async (url) => new Response(null, { status: url.endsWith('/limited') ? 403 : 200 }),
		})

		expect(result).toEqual({ check: 'links', passed: true, detail: null })
	})

	it('lists the original links and reasons for failures in source order', async () => {
		const links = [
			'https://example.com/gone',
			'https://example.com/down',
			'http://127.0.0.1/',
			'https://example.com/ok',
		]

		const result = await checkLinks(links, {
			lookup,
			fetch: async (url) => {
				if (url.endsWith('/down')) {
					throw new Error('connection failed')
				}

				return new Response(null, { status: url.endsWith('/gone') ? 404 : 200 })
			},
		})

		expect(result).toEqual({
			check: 'links',
			passed: false,
			detail:
				'https://example.com/gone: status 404; https://example.com/down: connection failed; http://127.0.0.1/: 127.0.0.1 is not a public address',
		})
	})

	it('propagates a stopped run', async () => {
		const controller = new AbortController()
		const reason = new Error('run stopped')

		const result = checkLinks(['https://example.com/'], {
			signal: controller.signal,
			lookup: async () => {
				controller.abort(reason)

				return Promise.withResolvers<string[]>().promise
			},
			fetch: async () => new Response(null),
		})

		expect(result).rejects.toBe(reason)
	})
})
