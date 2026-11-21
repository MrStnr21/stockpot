// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

/*
 * The service worker. Built by the `serviceWorker` integration in astro.config.ts, which defines
 * PRECACHE and VERSION and writes the bundle to dist/client/sw.js; the rules are in lib/offline/.
 */
import { createWorker } from '#/lib/offline/worker'

declare const PRECACHE: readonly string[]

declare const VERSION: string

/* The DOM library types the page, not the worker: its events and scope are declared here, as far as they are used. */
interface ExtendableEvent extends Event {
	waitUntil: (work: Promise<unknown>) => void
}

interface FetchEvent extends ExtendableEvent {
	readonly request: Request
	respondWith: (response: Promise<Response>) => void
}

declare global {
	function addEventListener(
		type: 'install' | 'activate',
		listener: (event: ExtendableEvent) => void,
	): void

	function addEventListener(type: 'fetch', listener: (event: FetchEvent) => void): void

	var skipWaiting: () => Promise<void>

	var clients: { claim: () => Promise<void> }
}

// A page that has not answered in this many milliseconds is replaced by its stored copy.
const pageTimeoutMs = 4000

const worker = createWorker({
	caches,
	fetch: async (input, init) => fetch(input, init),
	origin: location.origin,
	version: VERSION,
	precache: PRECACHE,
	timeoutMs: pageTimeoutMs,
})

// A new build takes over at once; the update keeps the old assets until stored pages are renewed.
addEventListener('install', (event) => {
	event.waitUntil(worker.install().then(globalThis.skipWaiting))
})

addEventListener('activate', (event) => {
	event.waitUntil(Promise.all([globalThis.clients.claim(), worker.activate()]))
})

addEventListener('fetch', (event) => {
	if (worker.handles(event.request)) {
		event.respondWith(
			worker.respond(event.request, (work) => {
				event.waitUntil(work)
			}),
		)
	}
})
