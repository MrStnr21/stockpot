// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

/*
 * A browser for the push toggle's controller: every push call is logged in order, and each answer is
 * set per test, so a spec can check what was called, in which order, and what was sent.
 */
import type {
	PushEnv,
	RegistrationLike,
	SubscriptionLike,
} from '#/features/push/client/push-controller.svelte'

export const pushEndpoint = 'https://fcm.googleapis.com/fcm/send/device-1'

/** A VAPID public key: an uncompressed P-256 point's length and first byte. */
export const vapidKeyBytes = Uint8Array.from({ length: 65 }, (_, index) =>
	index === 0 ? 4 : index,
)

export const vapidPublicKey = vapidKeyBytes.toBase64({ alphabet: 'base64url', omitPadding: true })

export const subscriptionJson = {
	endpoint: pushEndpoint,
	expirationTime: null,
	keys: { p256dh: 'p256dh-value', auth: 'auth-value' },
}

export interface SentRequest {
	readonly method: string
	readonly body: unknown
}

type SubscribeOptions = Parameters<RegistrationLike['pushManager']['subscribe']>[0]

/** A promise that never settles: a worker that never gets ready, a timer that never fires. */
async function pending<T>(): Promise<T> {
	return Promise.withResolvers<T>().promise
}

export class FakePushBrowser {
	public steps: string[] = []
	public requests: SentRequest[] = []
	public outsideHomeScreen = false
	public supported = true
	public permission: NotificationPermission = 'default'
	public answer: NotificationPermission = 'granted'
	public status = 201
	public subscription: SubscriptionLike | null = null
	public subscribeOptions: SubscribeOptions | null = null
	public registered = true
	public readyNever = false
	public subscribeFails = false
	public timedOut = false

	public readonly registration: RegistrationLike = {
		pushManager: {
			getSubscription: async () => {
				this.steps.push('getSubscription')

				return this.subscription
			},
			subscribe: async (options) => {
				this.steps.push('subscribe')
				this.subscribeOptions = options

				if (this.subscribeFails) {
					throw new DOMException('Push service not available', 'AbortError')
				}

				this.subscription = this.makeSubscription(options.applicationServerKey)

				return this.subscription
			},
		},
	}

	public readonly env: PushEnv = {
		outsideHomeScreen: () => this.outsideHomeScreen,
		supported: () => this.supported,
		permission: () => this.permission,
		requestPermission: async () => {
			this.steps.push('requestPermission')
			this.permission = this.answer

			return this.answer
		},
		ready: async () => {
			this.steps.push('ready')

			return this.readyNever ? pending<RegistrationLike>() : this.registration
		},
		getRegistration: async () => {
			this.steps.push('getRegistration')

			return this.registered ? this.registration : undefined
		},
		fetch: async (url, init) => {
			const method = init.method ?? 'GET'

			this.steps.push(`${method} ${url}`)
			this.requests.push({ method, body: await new Response(init.body).json() })

			return new Response(null, { status: method === 'DELETE' ? 204 : this.status })
		},
		sleep: async () => {
			if (this.readyNever) {
				this.timedOut = true

				return
			}

			await pending<undefined>()
		},
	}

	/** A subscription made with `key`, as the push manager hands it out. */
	public makeSubscription(key: Uint8Array): SubscriptionLike {
		return {
			endpoint: pushEndpoint,
			options: { applicationServerKey: new Uint8Array(key).buffer },
			toJSON: () => subscriptionJson,
			unsubscribe: async () => {
				this.steps.push('unsubscribe')
				this.subscription = null

				return true
			},
		}
	}
}
