// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

/*
 * Turns notifications on and off for this browser. The browser's push parts are passed in, so specs
 * run the flows against fakes; by default they are the real `navigator.serviceWorker`, `Notification`
 * and `fetch`, read only when a flow runs, as the island is rendered on the server first.
 */
import type { Messages } from '#/lib/i18n/en'

import { base64UrlToBytes, sameKey } from '../shared/base64url'

export type PushState =
	'needs-home-screen' | 'unsupported' | 'blocked' | 'off' | 'on' | 'working' | 'failed'

/** The parts of a `PushSubscription` the controller uses. */
export interface SubscriptionLike {
	readonly endpoint: string
	readonly options: { readonly applicationServerKey: ArrayBuffer | null }
	toJSON: () => PushSubscriptionJSON
	unsubscribe: () => Promise<boolean>
}

/** The parts of a `ServiceWorkerRegistration` the controller uses. */
export interface RegistrationLike {
	readonly pushManager: {
		getSubscription: () => Promise<SubscriptionLike | null>
		subscribe: (options: {
			userVisibleOnly: boolean
			applicationServerKey: Uint8Array<ArrayBuffer>
		}) => Promise<SubscriptionLike>
	}
}

export interface PushEnv {
	/** `navigator.standalone === false`: Safari on iPhone and iPad, outside a Home Screen app. */
	readonly outsideHomeScreen: () => boolean
	/** Whether the browser has a service worker, `PushManager` and `Notification`. */
	readonly supported: () => boolean
	/** `Notification.permission`. */
	readonly permission: () => NotificationPermission
	/** `Notification.requestPermission()`. */
	readonly requestPermission: () => Promise<NotificationPermission>
	/** `navigator.serviceWorker.ready`: waits for the worker. */
	readonly ready: () => Promise<RegistrationLike>
	/** `navigator.serviceWorker.getRegistration()`: the worker if there is one, without waiting. */
	readonly getRegistration: () => Promise<RegistrationLike | undefined>
	readonly fetch: (url: string, init: RequestInit) => Promise<Response>
	/** Resolves after `ms`; bounds the wait for the worker. */
	readonly sleep: (ms: number) => Promise<void>
}

export interface PushControllerOptions {
	/** The instance's VAPID public key, base64url. */
	readonly publicKey: string
	readonly env?: PushEnv
}

const subscriptionsUrl = '/api/push/subscriptions'

// The worker is registered on load; a browser that has none after this long will not get one.
const readyTimeoutMs = 10_000

const browserPush: PushEnv = {
	// Not in the DOM types: only Safari on iPhone and iPad has it.
	outsideHomeScreen: () => 'standalone' in navigator && navigator.standalone === false,
	supported: () =>
		'serviceWorker' in navigator && 'PushManager' in globalThis && 'Notification' in globalThis,
	permission: () => Notification.permission,
	requestPermission: async () => Notification.requestPermission(),
	ready: async () => navigator.serviceWorker.ready,
	getRegistration: async () => navigator.serviceWorker.getRegistration(),
	fetch: async (url, init) => fetch(url, init),
	sleep: async (ms) =>
		new Promise((resolve) => {
			setTimeout(resolve, ms)
		}),
}

async function unsubscribeQuietly(subscription: SubscriptionLike) {
	try {
		await subscription.unsubscribe()
	} catch {
		// The push service drops a subscription nobody uses; the server deletes it on the next 410.
	}
}

export class PushController {
	/** `working` until the first check, so the server renders a busy button rather than a guess. */
	public state = $state.raw<PushState>('working')

	/** What a busy button stands for: `on` while turning off, `off` otherwise. */
	public settled = $state.raw<'off' | 'on'>('off')

	readonly #key: Uint8Array<ArrayBuffer>
	readonly #env: PushEnv

	public constructor(options: PushControllerOptions) {
		this.#key = base64UrlToBytes(options.publicKey)
		this.#env = options.env ?? browserPush
	}

	/** Reads this browser's state once the island is in the page, and re-sends a live subscription. */
	public async mount(): Promise<void> {
		const env = this.#env

		/* Safari on iPhone has the push parts only in the Home Screen app. Checked only when they are
		 * missing, so a browser that has them is never sent to the Home Screen. */
		if (!env.supported()) {
			this.state = env.outsideHomeScreen() ? 'needs-home-screen' : 'unsupported'

			return
		}

		if (env.permission() === 'denied') {
			this.state = 'blocked'

			return
		}

		const subscription = await this.#current()

		if (subscription === null) {
			this.state = 'off'

			return
		}

		// Made with an older key: the server can no longer sign for it.
		if (!sameKey(subscription.options.applicationServerKey, this.#key)) {
			await unsubscribeQuietly(subscription)
			this.state = 'off'

			return
		}

		/* Safari on iOS fires no `pushsubscriptionchange`, so every visit re-sends the subscription, which also
		 * restores it after a database restore. A failure here keeps it: the next visit tries again. */
		await this.#save(subscription)
		this.state = 'on'
	}

	/** The tap on "Allow notifications". */
	public async enable(): Promise<void> {
		// Safari on iOS asks only inside the tap's user gesture, so nothing may be awaited before this call.
		const permission = await this.#env.requestPermission().catch(() => 'default' as const)

		if (permission !== 'granted') {
			this.state = permission === 'denied' ? 'blocked' : 'off'

			return
		}

		this.settled = 'off'
		this.state = 'working'

		const registration = await this.#ready()

		const subscription =
			registration === null ? null : await this.#subscribe(registration).catch(() => null)

		if (subscription === null) {
			this.state = 'failed'

			return
		}

		if (await this.#save(subscription)) {
			this.state = 'on'

			return
		}

		// The server does not have it, so nothing would arrive: drop it here too.
		await unsubscribeQuietly(subscription)
		this.state = 'failed'
	}

	/** The tap on "Turn off": the browser forgets the subscription first, then the server. */
	public async turnOff(): Promise<void> {
		this.settled = 'on'
		this.state = 'working'

		const subscription = await this.#current()

		if (subscription !== null) {
			const { endpoint } = subscription

			try {
				await subscription.unsubscribe()
			} catch {
				this.state = 'failed'

				return
			}

			// Best effort: a row left behind is deleted after the push service's first 410.
			await this.#request('DELETE', { endpoint })
		}

		this.state = 'off'
	}

	async #current(): Promise<SubscriptionLike | null> {
		try {
			const registration = await this.#env.getRegistration()

			return (await registration?.pushManager.getSubscription()) ?? null
		} catch {
			return null
		}
	}

	async #ready(): Promise<RegistrationLike | null> {
		const timeout = this.#env.sleep(readyTimeoutMs).then(() => null)

		return Promise.race([this.#env.ready(), timeout]).catch(() => null)
	}

	async #subscribe(registration: RegistrationLike) {
		return registration.pushManager.subscribe({
			userVisibleOnly: true,
			applicationServerKey: this.#key,
		})
	}

	async #save(subscription: SubscriptionLike): Promise<boolean> {
		return this.#request('POST', subscription.toJSON())
	}

	async #request(method: 'POST' | 'DELETE', body: PushSubscriptionJSON): Promise<boolean> {
		try {
			const response = await this.#env.fetch(subscriptionsUrl, {
				method,
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(body),
			})

			return response.ok
		} catch {
			return false
		}
	}
}

type PushStrings = Messages['push']

/** What the toggle shows: a line of text and, where there is something to do, one button. */
export interface PushView {
	readonly message: string
	readonly action: { readonly kind: 'enable' | 'turn-off'; readonly label: string } | null
	readonly busy: boolean
}

function settledView(state: Exclude<PushState, 'working'>, strings: PushStrings): PushView {
	const enable = { kind: 'enable', label: strings.settingsAllow } as const

	const views: Record<typeof state, Omit<PushView, 'busy'>> = {
		'needs-home-screen': { message: strings.settingsHomeScreen, action: null },
		unsupported: { message: strings.settingsUnsupported, action: null },
		blocked: { message: strings.settingsBlocked, action: null },
		off: { message: strings.settingsOff, action: enable },
		on: {
			message: strings.settingsOn,
			action: { kind: 'turn-off', label: strings.settingsTurnOff },
		},
		failed: { message: strings.settingsFailed, action: enable },
	}

	return { ...views[state], busy: false }
}

/** The view of a state; a busy toggle keeps the text and button of the state it left. */
export function pushView(state: PushState, settled: 'off' | 'on', strings: PushStrings): PushView {
	return state === 'working'
		? { ...settledView(settled, strings), busy: true }
		: settledView(state, strings)
}
