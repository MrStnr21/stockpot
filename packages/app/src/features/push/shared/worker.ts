// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

/*
 * The service worker's side of Web Push, with the browser's registration and clients passed in so
 * specs run it against fakes; src/sw.ts only wires it to the `push` and `notificationclick` events.
 * Every push shows a notification: Safari revokes the permission of a site whose push shows nothing.
 */
import * as v from 'valibot'

import { pushPayloadSchema, type PushPayload } from './payload'

/** The options the worker passes; `navigate` lets Safari 18.5 and later open the page itself. */
export interface ShownNotification {
	readonly body?: string
	readonly tag?: string
	readonly lang?: string
	readonly icon: string
	readonly data: { readonly navigate: string }
	readonly navigate: string
}

/** The part of a `WindowClient` the worker uses. */
export interface WindowClientLike {
	focus: () => Promise<object>
	navigate: (url: string) => Promise<object | null>
}

export interface PushWorkerEnv {
	/** The worker's own origin (`self.location.origin`): a tap opens nothing else. */
	readonly origin: string
	/** `registration.showNotification`. */
	readonly showNotification: (title: string, options: ShownNotification) => Promise<void>
	/** The app's open windows (`clients.matchAll({ type: 'window' })`). */
	readonly windows: () => Promise<readonly WindowClientLike[]>
	/** `clients.openWindow`. */
	readonly openWindow: (url: string) => Promise<object | null>
}

/** `PushEvent.data`: `null` for a push without a payload. */
export interface PushDataLike {
	text: () => string
}

/** The part of a `Notification` a click handler uses. */
export interface ClickedNotification {
	readonly data: unknown
	close: () => void
}

export interface PushWorker {
	/** Shows the push's notification, or a generic one when its payload is missing or invalid. */
	push: (data: PushDataLike | null) => Promise<void>
	/** Closes the notification and opens its page in an open window, or a new one. */
	click: (notification: ClickedNotification) => Promise<void>
}

const icon = '/icons/icon-192.png'

// A brand name: the same in every language.
const genericTitle = 'stockpot'

const clickData = v.object({ navigate: v.string() })

const pushText = v.pipe(v.string(), v.parseJson(), pushPayloadSchema)

/* The payload, or `null` when there is none or it is not JSON of the declarative shape. */
function readPayload(data: PushDataLike | null): PushPayload | null {
	if (data === null) {
		return null
	}

	const parsed = v.safeParse(pushText, data.text())

	return parsed.success ? parsed.output : null
}

export function createPushWorker(env: PushWorkerEnv): PushWorker {
	const home = new URL('/', env.origin).href

	/** `url` if it is a page of this app, else Today. */
	function ownPage(url: string): string {
		return URL.canParse(url) && new URL(url).origin === env.origin ? url : home
	}

	return {
		async push(data) {
			const payload = readPayload(data)
			const generic = { icon, data: { navigate: home }, navigate: home }

			if (payload === null) {
				await env.showNotification(genericTitle, generic)

				return
			}

			const { title, body, tag, lang, navigate } = payload.notification
			const target = ownPage(navigate)
			const options = { body, tag, lang, icon, data: { navigate: target }, navigate: target }

			try {
				await env.showNotification(title, options)
			} catch {
				// Refused options (a language tag, say) must still show something.
				await env.showNotification(genericTitle, generic)
			}
		},

		async click(notification) {
			notification.close()

			const data = v.safeParse(clickData, notification.data)
			const target = data.success ? ownPage(data.output.navigate) : home
			const windows = await env.windows()
			const open = windows.at(0)

			if (open !== undefined) {
				try {
					await open.focus()
					await open.navigate(target)

					return
				} catch {
					// A window this worker does not control cannot be navigated: open a new one.
				}
			}

			await env.openWindow(target)
		},
	}
}
