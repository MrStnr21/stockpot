// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { afterEach, beforeEach, describe, expect, it, mock, spyOn, type Mock } from 'bun:test'
import { faker } from '@faker-js/faker'
import { createCookieJar, nextRequestCookies, type TestCookieJar } from '#tests/setup/cookies'
import { createTestDb } from '#tests/setup/db'

import { createAuth } from '#/server/auth'
import { route, type RouteContext } from '#/server/http'
import type { Owner, OwnerResolver } from '#/server/policy'

import { createMiddleware } from './middleware'

const publicOrigin = 'https://stockpot.example.ts.net'

const owner: Owner = { id: 1 }

function formPost(origin: string) {
	return new Request(`${publicOrigin}/settings`, {
		method: 'POST',
		body: 'cardLanguage=de',
		headers: { origin, 'content-type': 'application/x-www-form-urlencoded' },
	})
}

function apiRequest() {
	return new Request(`${publicOrigin}/api/notes/7`)
}

/** A resolver that never returns an owner or `null`, as a slip in a later one could. */
async function forgetfulResolver(): Promise<undefined> {
	// It returns nothing.
}

describe('middleware', () => {
	let resolveOwner: Mock<OwnerResolver>
	let next: Mock<() => Promise<Response>>
	let locals: Partial<App.Locals>

	beforeEach(() => {
		resolveOwner = mock(async () => owner)
		next = mock(async () => new Response('page'))
		locals = { owner: null }
	})

	async function run(request: Request) {
		const middleware = createMiddleware({ resolveOwner, publicOrigin })

		return middleware({ request, locals, cookies: createCookieJar(), isPrerendered: false }, next)
	}

	describe('with a cross-site form post', () => {
		let response: Response

		beforeEach(async () => {
			response = await run(formPost('https://evil.example'))
		})

		it('answers 403 with a JSON error', async () => {
			expect([response.status, await response.json()]).toEqual([
				403,
				{ error: { code: 'cross_site', message: 'Requests from another site are refused.' } },
			])
		})

		it('runs neither the resolver nor the route', () => {
			expect([resolveOwner.mock.calls.length, next.mock.calls.length]).toEqual([0, 0])
		})
	})

	describe('with a resolver that returns undefined', () => {
		let response: Response

		beforeEach(async () => {
			resolveOwner.mockImplementation(forgetfulResolver)

			const authorizedRoute = route.authorized<RouteContext>(() => new Response('secret'))

			next.mockImplementation(async () =>
				authorizedRoute({ request: formPost(publicOrigin), locals }),
			)
			response = await run(formPost(publicOrigin))
		})

		it('stores nobody on locals', () => {
			expect(locals.owner).toBeNull()
		})

		it('gets a 401 from an authorized route', () => {
			expect(response.status).toBe(401)
		})
	})

	describe('when prerendering', () => {
		beforeEach(async () => {
			locals = {}
			await createMiddleware({ resolveOwner, publicOrigin })(
				{
					request: new Request(publicOrigin),
					locals,
					cookies: createCookieJar(),
					isPrerendered: true,
				},
				next,
			)
		})

		it('stores nobody on locals', () => {
			expect(locals.owner).toBeNull()
		})
	})

	describe('with a form post from the public origin', () => {
		let response: Response

		beforeEach(async () => {
			response = await run(formPost(publicOrigin))
		})

		it('puts the owner on locals', () => {
			expect(locals.owner).toEqual(owner)
		})

		it('runs the route', async () => {
			expect(await response.text()).toBe('page')
		})
	})

	describe('on /api/*', () => {
		let consoleError: Mock<typeof console.error>

		beforeEach(() => {
			consoleError = spyOn(console, 'error').mockImplementation(() => {
				// Keeps the expected error out of the test output.
			})
		})

		afterEach(() => {
			consoleError.mockRestore()
		})

		describe('when the route throws', () => {
			let response: Response

			beforeEach(async () => {
				next.mockImplementation(async () => {
					throw new Error('database is locked at /var/lib/stockpot/stockpot.db')
				})
				response = await run(apiRequest())
			})

			it('answers a JSON 500 that echoes nothing of the failure', async () => {
				expect([response.status, await response.json()]).toEqual([
					500,
					{ error: { code: 'internal', message: 'Something went wrong on the server.' } },
				])
			})

			it('logs the error', () => {
				expect(consoleError).toHaveBeenCalledTimes(1)
			})
		})

		it("turns Astro's HTML 500 page into a JSON 500", async () => {
			next.mockImplementation(async () => new Response('<h1>500</h1>', { status: 500 }))

			const response = await run(apiRequest())

			expect([response.status, await response.json()]).toEqual([
				500,
				{ error: { code: 'internal', message: 'Something went wrong on the server.' } },
			])
		})

		it('turns the HTML 404 page for an unknown path into a JSON 404', async () => {
			next.mockImplementation(async () => new Response('<h1>404</h1>', { status: 404 }))

			const response = await run(apiRequest())

			expect([response.status, await response.json()]).toEqual([
				404,
				{ error: { code: 'not_found', message: 'There is no such API route.' } },
			])
		})

		it('keeps a JSON 404 from the route', async () => {
			const noNote = Response.json({ error: { code: 'no_note' } }, { status: 404 })

			next.mockImplementation(async () => noNote)

			expect(await run(apiRequest())).toBe(noNote)
		})
	})

	describe('on a page', () => {
		it('leaves its 404 page as it is', async () => {
			const page = new Response('<h1>404</h1>', { status: 404 })

			next.mockImplementation(async () => page)

			expect(await run(new Request(`${publicOrigin}/nowhere`))).toBe(page)
		})

		it('lets an error through to Astro', async () => {
			next.mockImplementation(async () => {
				throw new Error('render failed')
			})

			const failure = await run(new Request(`${publicOrigin}/today`)).then(() => '', String)

			expect(failure).toBe('Error: render failed')
		})
	})

	describe('with the session resolver and a signed-in owner', () => {
		let signedIn: TestCookieJar
		let middleware: ReturnType<typeof createMiddleware>

		beforeEach(async () => {
			const { db } = await createTestDb()
			const announce = mock<(message: string) => void>()
			const auth = createAuth({ db, publicOrigin, announce })

			auth.needsSetup()

			const [message] = announce.mock.calls[0] ?? ['']
			const code = /setup code (?<code>\S+)\./u.exec(message)?.groups?.code ?? ''

			const cookies = createCookieJar()

			await auth.setUp(cookies, { code, password: faker.internet.password({ length: 16 }) })
			signedIn = nextRequestCookies(cookies)
			middleware = createMiddleware({ resolveOwner: auth.resolveOwner, publicOrigin })
		})

		/** The status of a POST to an authorized route that carries the owner's cookie. */
		async function postStatus(headers: Record<string, string>) {
			const request = new Request(`${publicOrigin}/api/notes`, { method: 'POST', headers })

			const context = {
				request,
				locals: { owner: null },
				cookies: nextRequestCookies(signedIn),
				isPrerendered: false,
			}

			const authorizedRoute = route.authorized<RouteContext>(() => new Response('saved'))
			const response = await middleware(context, async () => authorizedRoute(context))

			return response.status
		}

		it('answers 401 to a cookie-only POST with neither Origin nor Sec-Fetch-Site', async () => {
			expect(await postStatus({})).toBe(401)
		})

		it('lets the same POST through when it carries Origin', async () => {
			expect(await postStatus({ origin: publicOrigin })).toBe(200)
		})
	})
})
