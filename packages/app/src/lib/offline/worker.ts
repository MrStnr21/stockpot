// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

/*
 * The service worker's behaviour, with the browser's caches, network and clock passed in so specs
 * run it against fakes. src/sw.ts only wires it to the worker's events. Which data may stay on the
 * device, and when it is dropped, is decided in policy.ts and pages.ts.
 */
import { installAssets, serveAsset } from './assets'
import type { KeepAlive, WorkerEnv } from './env'
import { offlinePage, serveNavigation, servePage, serveSignOut } from './pages'
import { classifyRequest, type RequestKind } from './policy'
import { activateWorker } from './update'

export interface Worker {
	install: () => Promise<void>
	activate: () => Promise<void>
	/** Whether the worker answers this request; everything else is left to the network untouched. */
	handles: (request: Request) => boolean
	respond: (request: Request, keepAlive: KeepAlive) => Promise<Response>
}

export function createWorker(env: WorkerEnv): Worker {
	const precached = new Set(env.precache)

	function kindOf(request: Request) {
		return classifyRequest(request, env.origin, precached)
	}

	const answers: Record<
		RequestKind,
		(request: Request, keepAlive: KeepAlive) => Promise<Response>
	> = {
		'sign-out': async (request) => serveSignOut(env, request),
		asset: async (request) => serveAsset(env, request),
		'stored-page': async (request, keepAlive) =>
			servePage(env, new URL(request.url).pathname, keepAlive),
		navigation: async (request) => serveNavigation(env, request),
		ignored: async (request) => env.fetch(request),
	}

	return {
		async install() {
			await installAssets(env)
		},

		async activate() {
			await activateWorker(env)
		},

		handles(request) {
			return kindOf(request) !== 'ignored'
		},

		/* Never rejects: a browser shows its own error page for a rejected answer, and a failed sign-out must say so. */
		async respond(request, keepAlive) {
			const kind = kindOf(request)

			try {
				return await answers[kind](request, keepAlive)
			} catch {
				// A sign-out is not sent twice.
				if (kind === 'sign-out') {
					return offlinePage(env, 503)
				}

				return env.fetch(request).catch(async () => offlinePage(env))
			}
		},
	}
}
