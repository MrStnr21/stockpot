// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { CryptoHasher } from 'bun'

/** 32 random bytes: a token nobody can guess, sent as 43 base64url characters. */
export function randomToken(): string {
	return crypto.getRandomValues(new Uint8Array(32)).toBase64({
		alphabet: 'base64url',
		omitPadding: true,
	})
}

function sha256(value: string) {
	return new CryptoHasher('sha256').update(value).digest('hex')
}

/**
 * What the database stores instead of a token. A token carries 256 random bits, so a fast hash is
 * enough: a slow one would only slow down every request that carries a cookie.
 */
export function hashToken(token: string): string {
	return sha256(token)
}

/**
 * Whether two secrets are equal, in a time that does not depend on where they differ. Both are hashed
 * first, so the comparison always runs over 64 hex digits and does not reveal the length either.
 */
export function secretsMatch(given: string, expected: string): boolean {
	const left = sha256(given)
	const right = sha256(expected)
	let difference = 0

	for (let index = 0; index < left.length; index += 1) {
		// oxlint-disable-next-line no-bitwise -- XOR, then OR, is the constant-time comparison.
		difference |= left.charCodeAt(index) ^ right.charCodeAt(index)
	}

	return difference === 0
}
