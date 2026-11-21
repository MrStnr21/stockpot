// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { beforeEach, describe, expect, it } from 'bun:test'
import { createHarness, html, navigation, origin, type Harness } from '#tests/setup/offline'

import { createWorker, type Worker } from './worker'

describe('createWorker', () => {
	let harness: Harness
	let worker: Worker

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

		it('installs and activates', async () => {
			harness.network.answers.set('/', html('<html>today</html>'))
			await worker.activate()

			expect(harness.storage.urls('pages')).toEqual([`${origin}/`])
		})
	})
})
