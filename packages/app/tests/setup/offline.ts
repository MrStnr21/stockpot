// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

/* A service worker's world for specs: in-memory caches and a network whose answers a spec sets by path. */
import type { KeepAlive, WorkerEnv } from '#/lib/offline/env'

import { createFakeCacheStorage, type FakeCacheStorage } from './fake-caches'

export const origin = 'https://stockpot.example'

export const precache = ['/_astro/app.css', '/offline']

/** What the network does for a path: answer, fail, or never answer until the request is aborted. */
export type Answer = Response | Error | 'hang'

export function serverError(): Response {
	return new Response('boom', { status: 500, headers: { 'content-type': 'text/html' } })
}

export function html(
	body: string,
	overrides: { redirected?: boolean; url?: string; type?: string } = {},
): Response {
	const made = new Response(body, { headers: { 'content-type': 'text/html' } })

	// A constructed Response has type "default"; the network's is "basic".
	for (const [key, value] of Object.entries({ type: 'basic', ...overrides })) {
		Object.defineProperty(made, key, { value })
	}

	return made
}

/** The sign-in page a server answers with once the session is gone: the fetch followed a redirect to it. */
export function signInRedirect(): Response {
	return html('<html>sign in</html>', { redirected: true, url: `${origin}/signin` })
}

export function navigation(path: string, method = 'GET'): Request {
	const made = new Request(`${origin}${path}`, { method })

	Object.defineProperty(made, 'mode', { value: 'navigate' })
	Object.defineProperty(made, 'destination', { value: 'document' })

	return made
}

export interface Call {
	readonly url: string
	readonly cache: string | undefined
}

export interface FakeNetwork {
	readonly answers: Map<string, Answer>
	readonly calls: Call[]
	/** Runs when a request arrives, before it is answered. */
	onRequest: (() => void) | null
	fetch: (input: Request | string, init?: RequestInit) => Promise<Response>
}

export function createFakeNetwork(): FakeNetwork {
	const network: FakeNetwork = {
		answers: new Map(),
		calls: [],
		onRequest: null,

		async fetch(input, init) {
			const request = input instanceof Request ? input : new Request(input)
			const answer = network.answers.get(new URL(request.url).pathname)

			network.calls.push({ url: request.url, cache: init?.cache ?? request.cache })
			network.onRequest?.()

			if (answer === 'hang') {
				return new Promise<Response>((_resolve, reject) => {
					init?.signal?.addEventListener('abort', () => {
						reject(new Error('aborted'))
					})
				})
			}

			if (answer === undefined || answer instanceof Error) {
				throw answer ?? new Error('unreachable')
			}

			// A clone drops the properties html() set on the original.
			const copy = answer.clone()

			Object.defineProperties(copy, Object.getOwnPropertyDescriptors(answer))

			return copy
		},
	}

	return network
}

export interface Harness {
	readonly storage: FakeCacheStorage
	readonly network: FakeNetwork
	readonly keepAlive: KeepAlive
	/** How often the worker asked the browser for a newer worker. */
	readonly updates: { readonly count: number }
	/** The worker's environment for a build; `files` are the paths its install stores. */
	env: (version?: string, files?: readonly string[]) => WorkerEnv
	/** Waits for the work the worker kept alive past its answers. */
	settle: () => Promise<void>
}

export function createHarness(): Harness {
	const storage = createFakeCacheStorage()
	const network = createFakeNetwork()
	const pending: Promise<unknown>[] = []
	const updates = { count: 0 }

	return {
		storage,
		network,
		updates,

		keepAlive(work) {
			pending.push(work)
		},

		env(version = 'v1', files = precache) {
			return {
				caches: storage,
				fetch: async (input, init) => network.fetch(input, init),
				origin,
				version,
				precache: files,
				timeoutMs: 4000,
				renewTimeoutMs: 10_000,
				update: async () => {
					updates.count += 1
				},
			}
		},

		async settle() {
			await Promise.all(pending)
		},
	}
}
