// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { beforeEach, describe, expect, it, jest } from 'bun:test'
import {
	createHarness,
	html,
	navigation,
	origin,
	serverError,
	signInRedirect,
	type Harness,
} from '#tests/setup/offline'

import { installAssets } from './assets'
import { serveNavigation, servePage, serveSignOut } from './pages'

describe('the private pages', () => {
	let harness: Harness

	async function serve(path: string): Promise<Response> {
		const response = await servePage(harness.env(), path, harness.keepAlive)

		await harness.settle()

		return response
	}

	beforeEach(async () => {
		harness = createHarness()
		harness.network.answers.set('/_astro/app.css', new Response('body{}'))
		harness.network.answers.set('/offline', html('<html lang="en"><body>offline</body></html>'))
		await installAssets(harness.env())
		harness.network.calls.length = 0
	})

	describe('servePage', () => {
		it.each(['/', '/notes'])('stores a good copy of %s after serving it', async (path) => {
			harness.network.answers.set(path, html('<html lang="en">page</html>'))

			const response = await serve(path)

			expect(await response.text()).toBe('<html lang="en">page</html>')
			expect(harness.storage.urls('pages')).toEqual([`${origin}${path}`])
		})

		it('asks the network first and revalidates', async () => {
			harness.network.answers.set('/', html('<html>page</html>'))
			await serve('/')

			expect(harness.network.calls).toEqual([{ url: `${origin}/`, cache: 'no-cache' }])
		})

		it.each([
			['a server error', serverError()],
			['a plain-text answer', new Response('text', { headers: { 'content-type': 'text/plain' } })],
			['an answer of another type', html('<html>page</html>', { type: 'cors' })],
		])('passes %s through and stores nothing', async (_name, answer) => {
			harness.network.answers.set('/', answer)

			const response = await serve('/')

			expect(response.status).toBe(answer.status)
			expect(harness.storage.stores.has('pages')).toBe(false)
		})

		it('waits for a slow server when nothing is stored', async () => {
			harness.network.answers.set('/', 'hang')
			jest.useFakeTimers()

			const answering = serve('/')
			let isSettled = false

			const settling = answering.then(() => {
				isSettled = true
			})

			jest.advanceTimersByTime(10_000)
			jest.useRealTimers()
			await Promise.resolve()

			expect(isSettled).toBe(false)
			expect(settling).toBeInstanceOf(Promise)
		})

		describe('with a stored copy', () => {
			beforeEach(async () => {
				harness.network.answers.set('/', html('<html lang="en">today</html>'))
				await serve('/')
			})

			it('keeps the copy when a later answer is an error', async () => {
				harness.network.answers.set('/', serverError())
				await serve('/')
				harness.network.answers.delete('/')

				const response = await serve('/')

				expect(await response.text()).toBe('<html data-connection="offline" lang="en">today</html>')
			})

			it('serves it marked offline when the server is unreachable', async () => {
				harness.network.answers.delete('/')

				const response = await serve('/')

				expect(await response.text()).toBe('<html data-connection="offline" lang="en">today</html>')
			})

			it('serves it when a proxy answers 503 instead', async () => {
				harness.network.answers.set('/', new Response('down', { status: 503 }))

				const response = await serve('/')

				expect(await response.text()).toContain('data-connection="offline"')
			})

			it('serves it when the server has not answered in 4 seconds', async () => {
				harness.network.answers.set('/', 'hang')
				jest.useFakeTimers()

				const answering = serve('/')

				jest.advanceTimersByTime(4000)
				jest.useRealTimers()

				const answer = await answering

				expect(await answer.text()).toContain('data-connection="offline"')
			})

			describe('when the session is gone', () => {
				beforeEach(() => {
					harness.network.answers.set('/', signInRedirect())
				})

				it('passes the redirect on', async () => {
					const response = await serve('/')

					expect(response.status).toBe(302)
					expect(response.headers.get('location')).toBe(`${origin}/signin`)
				})

				it('drops every stored page and never stores the sign-in page', async () => {
					await serve('/')

					expect(harness.storage.stores.has('pages')).toBe(false)
				})
			})
		})

		it('serves the offline page for a page that was never stored', async () => {
			const response = await serve('/notes')

			expect(await response.text()).toBe(
				'<html data-connection="offline" lang="en"><body>offline</body></html>',
			)
		})
	})

	describe('serveNavigation', () => {
		it('goes to the network and stores nothing', async () => {
			harness.network.answers.set('/settings', html('<html>settings</html>'))

			const response = await serveNavigation(harness.env(), navigation('/settings'))

			expect(await response.text()).toBe('<html>settings</html>')
			expect(harness.storage.stores.has('pages')).toBe(false)
		})

		it('serves the offline page when the network fails', async () => {
			const response = await serveNavigation(harness.env(), navigation('/settings'))

			expect(await response.text()).toContain('data-connection="offline"')
		})
	})

	describe('serveSignOut', () => {
		beforeEach(async () => {
			harness.network.answers.set('/', html('<html>today</html>'))
			await serve('/')
		})

		it('deletes the pages cache before the request goes out', async () => {
			const seen: boolean[] = []

			harness.network.answers.set(
				'/signout',
				new Response(null, { status: 303, headers: { location: '/signin' } }),
			)
			harness.network.onRequest = () => {
				seen.push(harness.storage.stores.has('pages'))
			}

			const response = await serveSignOut(harness.env(), navigation('/signout', 'POST'))

			expect(seen).toEqual([false])
			expect(response.status).toBe(303)
		})

		it('drops the pages and answers with the offline page when the network fails', async () => {
			const response = await serveSignOut(harness.env(), navigation('/signout', 'POST'))

			expect(harness.storage.stores.has('pages')).toBe(false)
			expect(response.status).toBe(503)
			expect(await response.text()).toContain('data-connection="offline"')
		})
	})
})
