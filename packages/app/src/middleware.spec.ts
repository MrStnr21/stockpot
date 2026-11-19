// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { beforeEach, describe, expect, it, mock, type Mock } from 'bun:test'

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

describe('middleware', () => {
	let resolveOwner: Mock<OwnerResolver>
	let next: Mock<() => Promise<Response>>
	let locals: App.Locals

	beforeEach(() => {
		resolveOwner = mock(async () => owner)
		next = mock(async () => new Response('page'))
		locals = { owner: null }
	})

	async function run(request: Request) {
		const middleware = createMiddleware({ resolveOwner, publicOrigin })

		return middleware({ request, locals, isPrerendered: false }, next)
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
})
