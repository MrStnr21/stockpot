// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { beforeEach, describe, expect, it } from 'bun:test'
import { createHarness, html, origin, precache, type Harness } from '#tests/setup/offline'

import { findAsset, installAssets, serveAsset } from './assets'

describe('the precached assets', () => {
	let harness: Harness

	beforeEach(() => {
		harness = createHarness()
		harness.network.answers.set('/_astro/app.css', new Response('body{}'))
		harness.network.answers.set('/offline', html('<html></html>'))
	})

	describe('installAssets', () => {
		it('stores every file of the build in the versioned asset cache', async () => {
			await installAssets(harness.env())

			expect(harness.storage.urls('assets-v1').toSorted()).toEqual(
				precache.map((path) => `${origin}${path}`).toSorted(),
			)
		})

		it('asks the network past the HTTP cache', async () => {
			await installAssets(harness.env())

			expect(harness.network.calls.map(({ cache }) => cache)).toEqual(['reload', 'reload'])
		})

		it('fails when a file cannot be fetched, so the build is never half installed', async () => {
			harness.network.answers.set('/_astro/app.css', new Response('missing', { status: 404 }))

			const installing = installAssets(harness.env())

			expect(installing).rejects.toThrow('/_astro/app.css answered 404')
		})
	})

	describe('serveAsset', () => {
		beforeEach(async () => {
			await installAssets(harness.env())
			harness.network.calls.length = 0
		})

		it('answers a precached file from the cache without the network', async () => {
			const response = await serveAsset(harness.env(), new Request(`${origin}/_astro/app.css`))

			expect(await response.text()).toBe('body{}')
			expect(harness.network.calls).toEqual([])
		})

		it('asks the network for a file the cache does not hold', async () => {
			harness.network.answers.set('/_astro/other.css', new Response('other'))

			const response = await serveAsset(harness.env(), new Request(`${origin}/_astro/other.css`))

			expect(await response.text()).toBe('other')
		})
	})

	describe('findAsset', () => {
		beforeEach(async () => {
			const older = await harness.storage.open('assets-old')
			const newer = await harness.storage.open('assets-mid')

			await older.put(`${origin}/_astro/gone.css`, new Response('older'))
			await newer.put(`${origin}/_astro/gone.css`, new Response('mid'))
			await installAssets(harness.env('v2'))
		})

		it('finds a file of an older build while it is kept, newest first', async () => {
			const found = await findAsset(harness.env('v2'), '/_astro/gone.css')

			expect(await found?.text()).toBe('mid')
		})

		it('prefers the current build', async () => {
			const found = await findAsset(harness.env('v2'), '/_astro/app.css')

			expect(await found?.text()).toBe('body{}')
		})

		it('finds nothing for an unknown file', async () => {
			expect(await findAsset(harness.env('v2'), '/_astro/none.css')).toBeUndefined()
		})
	})
})
