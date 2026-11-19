// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { beforeEach, describe, expect, it, mock, type Mock } from 'bun:test'
import * as v from 'valibot'

import { HttpError, readJson, route, undeclaredHandlers, type RouteContext } from './http'
import type { Owner } from './policy'

const url = 'http://localhost:4321/api/notes'

const owner: Owner = { id: 1, via: 'session' }

function contextFor(request: Request, signedIn: Owner | null): RouteContext {
	return { request, locals: { owner: signedIn } }
}

const noteSchema = v.object({ text: v.pipe(v.string(), v.nonEmpty()) })

// Echoes a note read with a 32-byte limit.
const echoNote = route.public<RouteContext>(async ({ request }) =>
	Response.json(await readJson(request, noteSchema, 32)),
)

async function post(body: BodyInit, contentType = 'application/json') {
	return echoNote(
		contextFor(
			new Request(url, { method: 'POST', body, headers: { 'content-type': contentType } }),
			null,
		),
	)
}

/** A body sent in chunks, so the request carries no Content-Length. */
function streamOf(text: string) {
	return new ReadableStream<Uint8Array>({
		start(controller) {
			controller.enqueue(new TextEncoder().encode(text))
			controller.close()
		},
	})
}

describe('http', () => {
	describe('route.authorized', () => {
		let handler: Mock<(context: RouteContext, signedIn: Owner) => Response>

		beforeEach(() => {
			handler = mock(() => Response.json({ ok: true }))
		})

		describe('when nobody is signed in', () => {
			let response: Response

			beforeEach(async () => {
				response = await route.authorized<RouteContext>(handler)(contextFor(new Request(url), null))
			})

			it('answers 401 with a JSON error', async () => {
				expect(response.status).toBe(401)
				expect(await response.json()).toEqual({
					error: { code: 'unauthorized', message: 'Sign in to do this.' },
				})
			})

			it('never runs the handler', () => {
				expect(handler).not.toHaveBeenCalled()
			})
		})

		describe('when the middleware set no owner', () => {
			it('answers 401', async () => {
				const response = await route.authorized<RouteContext>(handler)({
					request: new Request(url),
					locals: {},
				})

				expect([response.status, handler.mock.calls.length]).toEqual([401, 0])
			})
		})

		describe('when prerendered', () => {
			it('refuses to render', async () => {
				const prerendered = route.authorized<RouteContext>(handler)({
					request: new Request(url),
					locals: { owner },
					isPrerendered: true,
				})

				const failure = await prerendered.then(() => '', String)

				expect(failure).toContain('route.authorized cannot be prerendered')
			})
		})

		describe('when the owner is signed in', () => {
			it('runs the handler with the owner', async () => {
				const response = await route.authorized<RouteContext>(handler)(
					contextFor(new Request(url), owner),
				)

				expect({ status: response.status, owner: handler.mock.calls[0]?.[1] }).toEqual({
					status: 200,
					owner,
				})
			})
		})
	})

	describe('route.public', () => {
		it('runs the handler for anyone', async () => {
			const response = await route.public<RouteContext>(() => Response.json({ ok: true }))(
				contextFor(new Request(url), null),
			)

			expect(response.status).toBe(200)
		})

		it('turns an HttpError into its JSON error', async () => {
			const response = await route.public<RouteContext>(() => {
				throw new HttpError(404, { code: 'not_found', message: 'No such note.' })
			})(contextFor(new Request(url), null))

			expect([response.status, await response.json()]).toEqual([
				404,
				{ error: { code: 'not_found', message: 'No such note.' } },
			])
		})

		it('lets any other error through to Astro', async () => {
			const failing = route.public<RouteContext>(() => {
				throw new Error('disk full')
			})

			const failure = await failing(contextFor(new Request(url), null)).then(() => '', String)

			expect(failure).toBe('Error: disk full')
		})
	})

	describe('readJson', () => {
		it('returns the validated body', async () => {
			const response = await post(JSON.stringify({ text: 'Bun' }))

			expect(await response.json()).toEqual({ text: 'Bun' })
		})

		const oversizeNote = JSON.stringify({ text: 'x'.repeat(40) })

		it.each([
			['a Content-Length over the limit', oversizeNote],
			['a streamed body over the limit', streamOf(oversizeNote)],
		])('refuses %s with 413', async (_name, body) => {
			const response = await post(body)

			expect([response.status, await response.json()]).toEqual([
				413,
				{ error: { code: 'body_too_large', message: 'The body is larger than 32 bytes.' } },
			])
		})

		it.each(['application/x-www-form-urlencoded', 'application/jsonfoo', 'text/json'])(
			'refuses a body sent as %s with 415',
			async (contentType) => {
				const response = await post(JSON.stringify({ text: 'Bun' }), contentType)

				expect(response.status).toBe(415)
			},
		)

		it('accepts the JSON media type in any case and with parameters', async () => {
			const response = await post(
				JSON.stringify({ text: 'Bun' }),
				'Application/JSON; charset=utf-8',
			)

			expect(response.status).toBe(200)
		})

		it('refuses text that is not JSON with 400', async () => {
			const response = await post('{"text":')

			expect([response.status, await response.json()]).toEqual([
				400,
				{ error: { code: 'invalid_json', message: 'The body is not valid JSON.' } },
			])
		})

		it('refuses a body that breaks the schema with 400 and one issue per field', async () => {
			const response = await post(JSON.stringify({ text: '' }))

			expect([response.status, await response.json()]).toEqual([
				400,
				{
					error: {
						code: 'invalid_body',
						message: 'The body does not match what this route accepts.',
						issues: [expect.stringMatching(/^text: /u)],
					},
				},
			])
		})
	})

	describe('undeclaredHandlers', () => {
		it('reports a bare handler', () => {
			expect(undeclaredHandlers({ GET: () => new Response() })).toEqual(['GET'])
		})

		it('passes handlers that declare their access', () => {
			const module = {
				GET: route.public(() => new Response()),
				POST: route.authorized(() => new Response()),
			}

			expect(undeclaredHandlers(module)).toEqual([])
		})

		it('reports only the bare ones in a mixed module', () => {
			const module = {
				GET: route.public(() => new Response()),
				DELETE: () => new Response(),
			}

			expect(undeclaredHandlers(module)).toEqual(['DELETE'])
		})
	})
})
