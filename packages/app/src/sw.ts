// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

/*
 * The service worker. Built by the `serviceWorker` integration in astro.config.ts, which defines
 * PRECACHE and VERSION and writes the bundle to dist/client/sw.js; the rules are in lib/offline/,
 * and those of notifications in features/push/shared/.
 */
import {
	createPushWorker,
	type ClickedNotification,
	type PushDataLike,
	type ShownNotification,
	type WindowClientLike,
} from '#/features/push/shared/worker'
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

interface PushEvent extends ExtendableEvent {
	readonly data: PushDataLike | null
}

interface NotificationEvent extends ExtendableEvent {
	readonly notification: ClickedNotification
}

declare global {
	function addEventListener(
		type: 'install' | 'activate',
		listener: (event: ExtendableEvent) => void,
	): void

	function addEventListener(type: 'fetch', listener: (event: FetchEvent) => void): void

	function addEventListener(type: 'push', listener: (event: PushEvent) => void): void

	function addEventListener(
		type: 'notificationclick',
		listener: (event: NotificationEvent) => void,
	): void

	var skipWaiting: () => Promise<void>

	var clients: {
		claim: () => Promise<void>
		matchAll: (options: {
			type: 'window'
			includeUncontrolled: boolean
		}) => Promise<readonly WindowClientLike[]>
		openWindow: (url: string) => Promise<object | null>
	}

	var registration: {
		update: () => Promise<void>
		showNotification: (title: string, options: ShownNotification) => Promise<void>
	}
}

// A page that has not answered in this many milliseconds is replaced by its stored copy.
const pageTimeoutMs = 4000

/*
 * Each stored page gets this long while an update renews them; Chromium holds the page's own
 * fetches until activation ends, so an unbounded wait would freeze the app.
 */
const renewTimeoutMs = 10_000

const worker = createWorker({
	caches,
	fetch: async (input, init) => fetch(input, init),
	origin: location.origin,
	version: VERSION,
	precache: PRECACHE,
	timeoutMs: pageTimeoutMs,
	renewTimeoutMs,
	update: async () => {
		await globalThis.registration.update()
	},
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

const push = createPushWorker({
	origin: location.origin,
	showNotification: async (title, options) =>
		globalThis.registration.showNotification(title, options),
	// A window opened before this worker took over is listed too; the click opens a new one for it.
	windows: async () => globalThis.clients.matchAll({ type: 'window', includeUncontrolled: true }),
	openWindow: async (url) => globalThis.clients.openWindow(url),
})

// Always waited for and always shows one: a push that shows nothing costs the permission on Safari.
addEventListener('push', (event) => {
	event.waitUntil(push.push(event.data))
})

addEventListener('notificationclick', (event) => {
	event.waitUntil(push.click(event.notification))
})
