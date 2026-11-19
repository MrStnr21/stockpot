// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { describe, expect, it } from 'bun:test'

import { ipv6Hextets, isPublicAddress } from './addresses'

describe('link addresses', () => {
	describe('isPublicAddress', () => {
		it.each([
			'127.0.0.1',
			'10.1.2.3',
			'172.20.0.1',
			'192.168.1.1',
			'169.254.169.254',
			'100.100.1.1',
			'0.0.0.0',
			'::',
			'::1',
			'::7f00:1',
			'::ffff:127.0.0.1',
			'::ffff:7f00:1',
			'[::ffff:7f00:1]',
			'::ffff:a00:1',
			'::ffff:8.8.8.8',
			'64:ff9b::7f00:1',
			'64:ff9b::8.8.8.8',
			'2002:7f00:1::1',
			'2002:a00:1::',
			'fd00::1',
			'fe80::1',
			'fec0::1',
			'ff02::1',
			'fe80::1%eth0',
			'1::2::3',
			'::ffff:999.0.0.1',
			'localhost',
		])('refuses %p', (address) => {
			expect(isPublicAddress(address)).toBe(false)
		})

		it.each(['93.184.215.14', '172.32.0.1', '2606:4700::1111', '2002:5db8:d70e::1'])(
			'allows %p',
			(address) => {
				expect(isPublicAddress(address)).toBe(true)
			},
		)
	})

	describe('ipv6Hextets', () => {
		it.each([
			['::ffff:127.0.0.1', [0, 0, 0, 0, 0, 0xff_ff, 0x7f_00, 1]],
			['2606:4700::1111', [0x26_06, 0x47_00, 0, 0, 0, 0, 0, 0x11_11]],
			['1:2:3:4:5:6:7:8', [1, 2, 3, 4, 5, 6, 7, 8]],
		])('expands %p', (address, hextets) => {
			expect(ipv6Hextets(address)).toEqual(hextets)
		})

		it.each(['1:2:3', '1:2:3:4:5:6:7:8::', 'g::1'])('rejects %p', (address) => {
			expect(ipv6Hextets(address)).toBeNull()
		})
	})
})
