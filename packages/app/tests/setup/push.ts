// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

/*
 * A browser's side of Web Push for specs: a subscription with a real P-256 key pair, made with Web
 * Crypto in the spec, and the decryption a browser does on a push (RFC 8291), so a spec can read what
 * the server sent; and a fake push service that answers the sender's requests.
 */
import { mock, type Mock } from 'bun:test'
import { subscriptionFactory } from '#tests/factories/push'

import type { PushFetch } from '#/features/push/server/send'
import type { Subscription } from '#/features/push/server/subscriptions'

export interface PushClient {
	readonly subscription: Subscription
	/** The plaintext of an `aes128gcm` push body sent to this subscription. */
	readonly decrypt: (body: Uint8Array<ArrayBuffer>) => Promise<string>
}

const encoder = new TextEncoder()

function toBase64Url(bytes: Uint8Array) {
	return bytes.toBase64({ alphabet: 'base64url', omitPadding: true })
}

interface HkdfInput {
	readonly salt: Uint8Array<ArrayBuffer>
	readonly secret: Uint8Array<ArrayBuffer>
	readonly info: Uint8Array<ArrayBuffer>
}

async function hkdf({ salt, secret, info }: HkdfInput, bits: number) {
	const key = await crypto.subtle.importKey('raw', secret, 'HKDF', false, ['deriveBits'])

	const derived = await crypto.subtle.deriveBits(
		{ name: 'HKDF', hash: 'SHA-256', salt, info },
		key,
		bits,
	)

	return new Uint8Array(derived)
}

function concat(...parts: Uint8Array[]) {
	const joined = new Uint8Array(parts.reduce((length, part) => length + part.byteLength, 0))
	let offset = 0

	for (const part of parts) {
		joined.set(part, offset)
		offset += part.byteLength
	}

	return joined
}

/** A subscription on a random allowed push service, with keys a browser would make. */
export async function pushClient(endpoint?: string): Promise<PushClient> {
	const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, false, [
		'deriveBits',
	])

	const publicKey = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey))
	const auth = crypto.getRandomValues(new Uint8Array(16))
	const built = subscriptionFactory.build()

	const subscription = {
		...built,
		endpoint: endpoint ?? built.endpoint,
		keys: { p256dh: toBase64Url(publicKey), auth: toBase64Url(auth) },
	}

	async function decrypt(body: Uint8Array<ArrayBuffer>) {
		// RFC 8188 §2.1 header: salt (16), record size (4), key id length (1), the sender's key (65).
		const salt = body.subarray(0, 16)
		const idLength = body.at(20) ?? 0
		const senderKey = body.subarray(21, 21 + idLength)
		const record = body.subarray(21 + idLength)

		const sender = await crypto.subtle.importKey(
			'raw',
			senderKey,
			{ name: 'ECDH', namedCurve: 'P-256' },
			false,
			[],
		)

		const shared = new Uint8Array(
			await crypto.subtle.deriveBits({ name: 'ECDH', public: sender }, pair.privateKey, 256),
		)

		// RFC 8291 §3.4 and §3.3.
		const keyInfo = concat(encoder.encode('WebPush: info\0'), publicKey, senderKey)
		const ikm = await hkdf({ salt: auth, secret: shared, info: keyInfo }, 256)
		const cekInfo = encoder.encode('Content-Encoding: aes128gcm\0')
		const nonceInfo = encoder.encode('Content-Encoding: nonce\0')
		const cek = await hkdf({ salt, secret: ikm, info: cekInfo }, 128)
		const nonce = await hkdf({ salt, secret: ikm, info: nonceInfo }, 96)

		const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt'])

		const padded = new Uint8Array(
			await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, key, record),
		)

		// The last record ends with the 0x02 delimiter, then zero padding (RFC 8188 §2).

		const delimiter = padded.findLastIndex((byte) => byte !== 0)

		if (padded[delimiter] !== 2) {
			throw new Error('The push body has no last-record delimiter')
		}

		return new TextDecoder().decode(padded.subarray(0, delimiter))
	}

	return { subscription, decrypt }
}

/** An answer a fake push service gives: a response, or an error the request throws. */
export type PushAnswer = Response | Error

/** A fake `fetch` that answers each push request with `answer(url)`; a 201 by default. */
export function fakePushFetch(
	answer: (url: string) => PushAnswer = () => new Response(null, { status: 201 }),
): Mock<PushFetch> {
	return mock<PushFetch>(async (url) => {
		const answered = answer(url)

		if (answered instanceof Error) {
			throw answered
		}

		return answered
	})
}

export interface PushRequest {
	readonly url: string
	readonly init: RequestInit
	readonly headers: Headers
	readonly body: Uint8Array<ArrayBuffer>
}

/** The request a fake `fetch` received, with its headers and its body as bytes. */
export function pushRequest(fetchMock: Mock<PushFetch>, index = 0): PushRequest {
	const call = fetchMock.mock.calls.at(index)

	if (call === undefined) {
		throw new Error(`No push request ${index}`)
	}

	const [url, init] = call

	if (!(init.body instanceof Uint8Array)) {
		throw new TypeError('The push body is not bytes')
	}

	return { url, init, headers: new Headers(init.headers), body: new Uint8Array(init.body) }
}
