// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

/*
 * The VAPID public key travels as base64url text, and a browser subscribes with its bytes. Decoded
 * with `atob` rather than `Uint8Array.fromBase64`, which iOS Safari only has from 18.2 while Web Push
 * reaches Home Screen apps from 16.4.
 */

/** The bytes of a base64url value, with or without padding; throws on anything else. */
export function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
	const base64 = value.replaceAll('-', '+').replaceAll('_', '/')
	const binary = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '='))

	return Uint8Array.from(binary, (char) => char.codePointAt(0) ?? 0)
}

/** Whether a key a subscription was made with is exactly these bytes. */
export function sameKey(key: ArrayBuffer | null, bytes: Uint8Array): boolean {
	if (key === null || key.byteLength !== bytes.length) {
		return false
	}

	const view = new Uint8Array(key)

	return view.every((byte, index) => byte === bytes[index])
}
