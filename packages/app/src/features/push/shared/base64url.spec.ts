// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { describe, expect, it } from 'bun:test'

import { base64UrlToBytes, sameKey } from './base64url'

describe('base64url', () => {
	describe('base64UrlToBytes', () => {
		it.each([1, 2, 3, 16, 65])('reads %i random bytes as the server writes them', (length) => {
			const bytes = crypto.getRandomValues(new Uint8Array(length))
			const text = bytes.toBase64({ alphabet: 'base64url', omitPadding: true })

			expect(base64UrlToBytes(text)).toEqual(bytes)
		})

		it('reads the characters that differ from base64, and padding', () => {
			expect([...base64UrlToBytes('-_8='), ...base64UrlToBytes('-_8')]).toEqual([
				0xfb, 0xff, 0xfb, 0xff,
			])
		})

		it('refuses text that is not base64url', () => {
			expect(() => base64UrlToBytes('not base64!')).toThrow()
		})
	})

	describe('sameKey', () => {
		const bytes = Uint8Array.of(4, 1, 2, 3)

		it('matches a key with the same bytes', () => {
			expect(sameKey(Uint8Array.of(4, 1, 2, 3).buffer, bytes)).toBe(true)
		})

		it.each([
			['another byte', Uint8Array.of(4, 1, 2, 9).buffer],
			['another length', Uint8Array.of(4, 1, 2).buffer],
			['no key', null],
		])('refuses %s', (_name, key) => {
			expect(sameKey(key, bytes)).toBe(false)
		})
	})
})
