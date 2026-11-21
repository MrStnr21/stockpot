// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { beforeEach, describe, expect, it } from 'bun:test'
import { createHarness, html, navigation, origin, type Harness } from '#tests/setup/offline'

import { createWorker, type Worker } from './worker'

describe('createWorker', () => {
	let harness: Harness
	let worker: Worker

	async function storedPage(path: string): Promise<string | undefined> {
		const pages = await harness.storage.open('pages')
		const stored = await pages.match(`${origin}${path}`)

		return stored?.text()
	}

	beforeEach(async () => {
		harness = createHarness()
		harness.network.answers.set('/_astro/app.css', new Response('body{}'))
		harness.network.answers.set('/offline', html('<html lang="en">offline</html>'))
		worker = createWorker(harness.env())
		await worker.install()
		harness.network.calls.length = 0
	})

	describe('handles', () => {
		it.each([
			['a navigation to Today', navigation('/')],
			['a navigation to another page', navigation('/base')],
			['the sign-out form', navigation('/signout', 'POST')],
			['a precached file', new Request(`${origin}/_astro/app.css`)],
		])('answers %s', (_name, request) => {
			expect(worker.handles(request)).toBe(true)
		})

		it.each([
			['an API call', new Request(`${origin}/api/notes`)],
			['a POST', new Request(`${origin}/api/notes`, { method: 'POST' })],
			['a file of another origin', new Request('https://other.example/_astro/app.css')],
			['a fetch to Today', new Request(`${origin}/`)],
		])('leaves %s to the network', (_name, request) => {
			expect(worker.handles(request)).toBe(false)
		})
	})

	describe('respond', () => {
		it('serves a precached file from the cache', async () => {
			const request = new Request(`${origin}/_astro/app.css`)
			const response = await worker.respond(request, harness.keepAlive)

			expect(await response.text()).toBe('body{}')
			expect(harness.network.calls).toEqual([])
		})

		it('stores Today after serving it', async () => {
			harness.network.answers.set('/', html('<html>today</html>'))
			await worker.respond(navigation('/'), harness.keepAlive)
			await harness.settle()

			expect(harness.storage.urls('pages')).toEqual([`${origin}/`])
		})

		describe('a file of an older build', () => {
			beforeEach(async () => {
				const old = await harness.storage.open('assets-v1')

				await old.put(`${origin}/_astro/old.css`, new Response('old css'))
				harness.network.answers.set('/_astro/app.css', new Response('new css'))
				worker = createWorker(harness.env('v2'))
				await worker.install()
				harness.network.calls.length = 0
			})

			it('is answered from the old cache, and not stored again', async () => {
				const request = new Request(`${origin}/_astro/old.css`)

				expect(worker.handles(request)).toBe(true)

				const response = await worker.respond(request, harness.keepAlive)

				expect(await response.text()).toBe('old css')
				expect(harness.network.calls).toEqual([])
				expect(harness.storage.urls('assets-v2')).not.toContain(`${origin}/_astro/old.css`)
			})

			it('goes to the network when no cache has it, storing nothing', async () => {
				harness.network.answers.set('/_astro/unknown.css', new Response('from server'))

				const response = await worker.respond(
					new Request(`${origin}/_astro/unknown.css`),
					harness.keepAlive,
				)

				expect(await response.text()).toBe('from server')
				expect(harness.storage.urls('assets-v2')).not.toContain(`${origin}/_astro/unknown.css`)
			})
		})

		describe('a page that names a file no cache holds', () => {
			beforeEach(async () => {
				harness.network.answers.set('/', html('<html>today v1</html>'))
				await worker.respond(navigation('/'), harness.keepAlive)
				await harness.settle()

				harness.network.answers.set(
					'/',
					html('<html><link href="/_astro/newer.css">today v2</html>'),
				)
			})

			it('is served but not stored, and a newer worker is asked for', async () => {
				const response = await worker.respond(navigation('/'), harness.keepAlive)

				await harness.settle()

				expect(await response.text()).toContain('today v2')
				expect(harness.updates.count).toBe(1)

				expect(await storedPage('/')).toBe('<html>today v1</html>')
			})

			it('is stored once a cache holds the file', async () => {
				const old = await harness.storage.open('assets-v0')

				await old.put(`${origin}/_astro/newer.css`, new Response('css'))
				await worker.respond(navigation('/'), harness.keepAlive)
				await harness.settle()

				expect(await storedPage('/')).toContain('today v2')
				expect(harness.updates.count).toBe(0)
			})
		})

		describe('the sign-out form while the server is out of reach', () => {
			beforeEach(async () => {
				harness.network.answers.set('/', html('<html>today</html>'))
				await worker.respond(navigation('/'), harness.keepAlive)
				await harness.settle()
			})

			it('drops the pages and answers 503 with the offline page instead of rejecting', async () => {
				const response = await worker.respond(navigation('/signout', 'POST'), harness.keepAlive)

				expect(response.status).toBe(503)
				expect(await response.text()).toContain('data-connection="offline"')
				expect(harness.storage.stores.has('pages')).toBe(false)
			})
		})

		describe('a handler that throws', () => {
			// Reading the cache names fails, which the page rules do not catch.
			let broken: Worker

			beforeEach(() => {
				const env = harness.env()

				broken = createWorker({
					...env,
					caches: {
						open: async (name) => env.caches.open(name),
						delete: async (name) => env.caches.delete(name),
						keys: async () => {
							throw new Error('storage failed')
						},
					},
				})
			})

			it('falls back to the network answer', async () => {
				harness.network.answers.set('/', html('<html>today</html>'))

				const response = await broken.respond(navigation('/'), harness.keepAlive)

				expect(await response.text()).toBe('<html>today</html>')
			})

			it('falls back to the offline page when the network fails too', async () => {
				const response = await broken.respond(navigation('/'), harness.keepAlive)

				expect(await response.text()).toContain('data-connection="offline"')
			})
		})

		it('installs and activates', async () => {
			harness.network.answers.set('/', html('<html>today</html>'))
			await worker.activate()

			expect(harness.storage.urls('pages')).toEqual([`${origin}/`])
		})
	})
})
