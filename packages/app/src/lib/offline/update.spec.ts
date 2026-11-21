// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { beforeEach, describe, expect, it } from 'bun:test'
import {
	createHarness,
	html,
	origin,
	serverError,
	signInRedirect,
	type Harness,
} from '#tests/setup/offline'

import { findAsset, installAssets } from './assets'
import { servePage } from './pages'
import { activateWorker } from './update'

describe('activateWorker', () => {
	let harness: Harness

	async function storedText(path: string): Promise<string | undefined> {
		const pages = await harness.storage.open('pages')
		const stored = await pages.match(`${origin}${path}`)

		return stored?.text()
	}

	beforeEach(async () => {
		harness = createHarness()
		harness.network.answers.set('/_astro/app.css', new Response('body{}'))
		harness.network.answers.set('/offline', html('<html>offline v1</html>'))
		await installAssets(harness.env('v1'))
	})

	describe('on the first activation', () => {
		it('stores Today, so the first visit is kept too', async () => {
			harness.network.answers.set('/', html('<html>today</html>'))
			await activateWorker(harness.env('v1'))

			expect(harness.storage.urls('pages')).toEqual([`${origin}/`])
		})

		it('stores nothing while signed out', async () => {
			harness.network.answers.set('/', signInRedirect())
			await activateWorker(harness.env('v1'))

			expect(harness.storage.stores.has('pages')).toBe(false)
		})
	})

	describe('after an update', () => {
		beforeEach(async () => {
			harness.network.answers.set('/', html('<html>today v1</html>'))
			harness.network.answers.set('/notes', html('<html>notes v1</html>'))
			await servePage(harness.env('v1'), '/', harness.keepAlive)
			await servePage(harness.env('v1'), '/notes', harness.keepAlive)
			await harness.settle()

			harness.network.answers.set('/_astro/app.css', new Response('body{v2}'))
			harness.network.answers.set('/', html('<html>today v2</html>'))
			harness.network.answers.set('/notes', html('<html>notes v2</html>'))
			await installAssets(harness.env('v2'))
		})

		it('renews every stored page, then drops the old assets', async () => {
			await activateWorker(harness.env('v2'))

			expect(await storedText('/')).toBe('<html>today v2</html>')
			expect(await storedText('/notes')).toBe('<html>notes v2</html>')
			expect(await harness.storage.keys()).toEqual(['pages', 'assets-v2'])
		})

		it('keeps the old assets while a stored page could not be renewed', async () => {
			harness.network.answers.delete('/notes')
			await activateWorker(harness.env('v2'))

			expect(await harness.storage.keys()).toContain('assets-v1')
			expect(await storedText('/notes')).toBe('<html>notes v1</html>')
			expect(await storedText('/')).toBe('<html>today v2</html>')
		})

		it('keeps the old assets when a stored page does not answer in time', async () => {
			harness.network.answers.set('/notes', 'hang')

			await activateWorker({ ...harness.env('v2'), renewTimeoutMs: 20 })

			expect(await harness.storage.keys()).toContain('assets-v1')
			expect(await storedText('/notes')).toBe('<html>notes v1</html>')
		})

		it('keeps the old assets when a renewed page answers with an error', async () => {
			harness.network.answers.set('/notes', serverError())
			await activateWorker(harness.env('v2'))

			expect(await harness.storage.keys()).toContain('assets-v1')
		})

		it('still serves a file of the old build to a page stored under it', async () => {
			const old = await harness.storage.open('assets-v1')

			await old.put(`${origin}/_astro/gone.css`, new Response('old build css'))
			harness.network.answers.delete('/')
			await activateWorker(harness.env('v2'))

			const found = await findAsset(harness.env('v2'), '/_astro/gone.css')

			expect(await found?.text()).toBe('old build css')
		})

		it('drops the pages and the old assets when the session is gone', async () => {
			harness.network.answers.set('/', signInRedirect())
			await activateWorker(harness.env('v2'))

			expect(harness.storage.stores.has('pages')).toBe(false)
			expect(await harness.storage.keys()).toEqual(['assets-v2'])
		})
	})
})
