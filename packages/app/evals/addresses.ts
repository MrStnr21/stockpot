// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

/*
 * Which IP addresses the link check may open (docs/engines.md, "Links"): none that is loopback,
 * private, link-local or otherwise reserved, in any IPv4 or IPv6 notation.
 */

export function ipv4Parts(address: string): number[] | null {
	const parts = address.split('.').map(Number)
	const isValid = parts.length === 4 && parts.every((part) => Number.isInteger(part) && part <= 255)

	return isValid ? parts : null
}

// Not public, from the IANA special-purpose registry; 224.0.0.0/3 is multicast and reserved.
const reservedIpv4: readonly (readonly [string, number])[] = [
	['0.0.0.0', 8],
	['10.0.0.0', 8],
	['100.64.0.0', 10],
	['127.0.0.0', 8],
	['169.254.0.0', 16],
	['172.16.0.0', 12],
	['192.0.0.0', 24],
	['192.168.0.0', 16],
	['198.18.0.0', 15],
	['224.0.0.0', 3],
]

function ipv4Number(parts: readonly number[]): number {
	return parts.reduce((total, part) => total * 256 + part, 0)
}

function isPublicIpv4(parts: readonly number[]): boolean {
	const address = ipv4Number(parts)

	return reservedIpv4.every(([base, prefix]) => {
		const size = 2 ** (32 - prefix)
		const start = ipv4Number(ipv4Parts(base) ?? [])

		return address < start || address >= start + size
	})
}

/** The last group of an IPv6 address may be a dotted IPv4 address: two hextets. */
function expandIpv4Tail(groups: readonly string[]): string[] | null {
	const tail = groups.at(-1)

	if (tail?.includes('.') !== true) {
		return [...groups]
	}

	const [a = 0, b = 0, c = 0, d = 0] = ipv4Parts(tail) ?? []

	return ipv4Parts(tail) === null
		? null
		: [...groups.slice(0, -1), (a * 256 + b).toString(16), (c * 256 + d).toString(16)]
}

const hextet = /^[\da-f]{1,4}$/u

function hextetsOf(groups: readonly string[]): number[] | null {
	return groups.every((group) => hextet.test(group))
		? groups.map((group) => Number.parseInt(group, 16))
		: null
}

/** The eight 16-bit groups of an IPv6 address, or `null` when it is not one. */
export function ipv6Hextets(address: string): number[] | null {
	const halves = address.split('::')

	if (halves.length > 2) {
		return null
	}

	const [left = [], right = []] = halves.map((half) => (half === '' ? [] : half.split(':')))
	const isCompressed = halves.length === 2
	const head = hextetsOf(isCompressed ? left : [])
	const tail = expandIpv4Tail(isCompressed ? right : left)
	const rest = tail === null ? null : hextetsOf(tail)

	if (head === null || rest === null) {
		return null
	}

	const missing = 8 - head.length - rest.length

	if (!isCompressed) {
		return missing === 0 ? rest : null
	}

	return missing >= 1 ? [...head, ...Array.from({ length: missing }, () => 0), ...rest] : null
}

/*
 * IPv6 ranges that are not public, from the IANA special-purpose registry: ::/96 (unspecified,
 * loopback and IPv4-compatible), ::ffff:0:0/96 (IPv4-mapped, in either notation), 64:ff9b::/96
 * (NAT64), and everything from fc00:: up (unique local, link-local, site-local, multicast). 2002::/16
 * (6to4) carries an IPv4 address, which must be public itself.
 */
const reservedPrefixes = new Set(
	[
		[0, 0, 0, 0, 0, 0],
		[0, 0, 0, 0, 0, 0xff_ff],
		[0x64, 0xff_9b, 0, 0, 0, 0],
	].map((prefix) => prefix.join(':')),
)

function isPublicIpv6(hextets: readonly number[]): boolean {
	if (reservedPrefixes.has(hextets.slice(0, 6).join(':'))) {
		return false
	}

	const [h0 = 0, h1 = 0, h2 = 0] = hextets

	if (h0 === 0x20_02) {
		return isPublicIpv4([Math.floor(h1 / 256), h1 % 256, Math.floor(h2 / 256), h2 % 256])
	}

	return h0 < 0xfc_00
}

/** Whether an IP address may be fetched: not loopback, private, link-local or otherwise reserved. */
export function isPublicAddress(address: string): boolean {
	const ip = address.replaceAll(/^\[|\]$/gu, '').toLowerCase()
	const v4 = ipv4Parts(ip)

	if (v4 !== null) {
		return isPublicIpv4(v4)
	}

	// A zone id ("%eth0") only ever names a local interface.
	const hextets = ip.includes('%') ? null : ipv6Hextets(ip)

	return hextets !== null && isPublicIpv6(hextets)
}

/** Whether a URL host, brackets removed, is an IP address rather than a name to resolve. */
export function isIpLiteral(host: string): boolean {
	return ipv4Parts(host) !== null || host.includes(':')
}
