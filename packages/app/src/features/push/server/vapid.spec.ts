// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { afterEach, beforeEach, describe, expect, it, spyOn, type Mock } from 'bun:test'
import { createTestDb, type TestDb } from '#tests/setup/db'

import { pushKeys } from '#/server/db/schema/push'
import { log, type Logger } from '#/server/log'

import { vapidKeys, vapidPublicKey, type VapidKeys } from './vapid'

function fromBase64Url(value: string) {
	return Uint8Array.fromBase64(value, { alphabet: 'base64url' })
}

async function importKeys({ publicKey, privateKey }: VapidKeys) {
	const point = fromBase64Url(publicKey)

	const coordinates = {
		kty: 'EC',
		crv: 'P-256',
		x: point.subarray(1, 33).toBase64({ alphabet: 'base64url', omitPadding: true }),
		y: point.subarray(33).toBase64({ alphabet: 'base64url', omitPadding: true }),
	}

	const algorithm = { name: 'ECDSA', namedCurve: 'P-256' }

	return {
		signing: await crypto.subtle.importKey(
			'jwk',
			{ ...coordinates, d: privateKey },
			algorithm,
			false,
			['sign'],
		),
		verifying: await crypto.subtle.importKey('raw', point, algorithm, false, ['verify']),
	}
}

describe('vapidKeys', () => {
	let db: TestDb
	let logs: Mock<Logger['info']>[]

	beforeEach(async () => {
		;({ db } = await createTestDb())
		logs = (['info', 'warn', 'error'] as const).map((level) =>
			spyOn(log, level).mockImplementation(() => {
				// The spy records the call; nothing is written.
			}),
		)
	})

	afterEach(() => {
		for (const spy of logs) {
			spy.mockRestore()
		}
	})

	describe('on first use', () => {
		let keys: VapidKeys

		beforeEach(async () => {
			keys = await vapidKeys(db)
		})

		it('makes a public key that is an uncompressed P-256 point', () => {
			const point = fromBase64Url(keys.publicKey)

			expect({ length: point.length, prefix: point[0] }).toEqual({ length: 65, prefix: 0x04 })
		})

		it('makes a 32-byte private key', () => {
			expect(fromBase64Url(keys.privateKey)).toHaveLength(32)
		})

		it('makes a private key that signs for the public key', async () => {
			const { signing, verifying } = await importKeys(keys)
			const data = new TextEncoder().encode('stockpot')
			const algorithm = { name: 'ECDSA', hash: 'SHA-256' }
			const signature = await crypto.subtle.sign(algorithm, signing, data)

			expect(await crypto.subtle.verify(algorithm, verifying, signature, data)).toBe(true)
		})

		it('stores one row', () => {
			expect(db.select().from(pushKeys).all()).toMatchObject([{ id: 1, ...keys }])
		})

		it('says it created the keys, with no fields', () => {
			expect(logs[0]?.mock.calls).toEqual([['Created the Web Push keys']])
		})

		it('returns the same keys on a second call', async () => {
			expect(await vapidKeys(db)).toEqual(keys)
		})

		it('logs neither key, on the first call or later ones', async () => {
			await vapidKeys(db)
			await vapidPublicKey(db)

			const logged = JSON.stringify(logs.flatMap((spy) => spy.mock.calls))

			expect([logged.includes(keys.publicKey), logged.includes(keys.privateKey)]).toEqual([
				false,
				false,
			])
		})
	})

	describe('when two calls start on an empty database', () => {
		it('agree on one key pair and store one row', async () => {
			const [first, second] = await Promise.all([vapidKeys(db), vapidKeys(db)])

			expect({ same: first, rows: db.select().from(pushKeys).all().length }).toEqual({
				same: second,
				rows: 1,
			})
		})

		it('log the creation once', async () => {
			await Promise.all([vapidKeys(db), vapidKeys(db)])

			expect(logs[0]?.mock.calls).toHaveLength(1)
		})
	})

	describe('vapidPublicKey', () => {
		it('returns only the stored public key', async () => {
			const { publicKey } = await vapidKeys(db)

			expect(await vapidPublicKey(db)).toBe(publicKey)
		})
	})
})
