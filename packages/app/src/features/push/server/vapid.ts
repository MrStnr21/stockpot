// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

/*
 * The instance's VAPID key pair (RFC 8292), which signs every push request so a push service accepts
 * it, and which each browser binds its subscription to. It is made once, on the first start, and kept
 * in the `push_keys` row; replacing it would orphan every subscription. Only this module and the sender
 * read the private key, and nothing logs either key.
 */
import type { Db } from '#/server/db/client'
import { pushKeys } from '#/server/db/schema/push'
import { log } from '#/server/log'

/** Both keys as base64url without padding: the raw public point and the private scalar (JWK `d`). */
export interface VapidKeys {
	publicKey: string
	privateKey: string
}

function toBase64Url(bytes: Uint8Array) {
	return bytes.toBase64({ alphabet: 'base64url', omitPadding: true })
}

async function generateKeys(): Promise<VapidKeys> {
	const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
		'sign',
	])

	const publicPoint = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey))
	const { d } = await crypto.subtle.exportKey('jwk', pair.privateKey)

	if (d === undefined) {
		throw new Error('The generated Web Push key has no private part')
	}

	return { publicKey: toBase64Url(publicPoint), privateKey: d }
}

function readKeys(db: Pick<Db, 'select'>): VapidKeys | undefined {
	return db
		.select({ publicKey: pushKeys.publicKey, privateKey: pushKeys.privateKey })
		.from(pushKeys)
		.get()
}

/**
 * The stored key pair, made and stored on first use. Two callers that both find no row each make a
 * pair, but only the first insert lands and both read that row back, so the instance keeps one key.
 */
export async function vapidKeys(db: Db): Promise<VapidKeys> {
	const stored = readKeys(db)

	if (stored !== undefined) {
		return stored
	}

	const created = await generateKeys()

	const inserted = db
		.insert(pushKeys)
		.values({ id: 1, ...created })
		.onConflictDoNothing()
		.run()

	if (inserted.changes > 0) {
		log.info('Created the Web Push keys')
	}

	const kept = readKeys(db)

	if (kept === undefined) {
		throw new Error('The Web Push keys were not stored')
	}

	return kept
}

/** The public key a browser subscribes with (`applicationServerKey`); the only part pages may show. */
export async function vapidPublicKey(db: Db): Promise<string> {
	const { publicKey } = await vapidKeys(db)

	return publicKey
}
