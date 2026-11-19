// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

/*
 * The "links open" check (docs/engines.md, "Links"): every address a card cites must answer, and none
 * may lead to a loopback, private or link-local address once DNS is resolved, redirects included.
 * The server's own link check (RES-2) will also cap the size it reads; a HEAD request reads nothing,
 * and a GET fallback cancels the body at once.
 */
import { dns } from 'bun'

import type { CheckResult } from './checks'

export type Lookup = (hostname: string) => Promise<readonly string[]>

export type Fetch = (url: string, init: RequestInit) => Promise<Response>

export interface LinkCheckOptions {
	readonly lookup?: Lookup
	readonly fetch?: Fetch
	/** Per request; a redirect starts a new request. */
	readonly timeoutMs?: number
}

const maxRedirects = 5

function ipv4Parts(address: string): number[] | null {
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

async function bunLookup(hostname: string): Promise<string[]> {
	const records = await dns.lookup(hostname)

	return records.map(({ address }) => address)
}

async function addressesOf(hostname: string, lookup: Lookup): Promise<readonly string[]> {
	const literal = hostname.replaceAll(/^\[|\]$/gu, '')

	return ipv4Parts(literal) !== null || literal.includes(':') ? [literal] : lookup(hostname)
}

interface Hop {
	readonly url: URL
	readonly redirects: number
}

type LinkOutcome = { readonly ok: true } | { readonly ok: false; readonly reason: string }

async function request(url: URL, method: string, { fetch, timeoutMs }: Required<LinkCheckOptions>) {
	const response = await fetch(url.href, {
		method,
		redirect: 'manual',
		signal: AbortSignal.timeout(timeoutMs),
	})

	await response.body?.cancel()

	return response
}

async function openHop(hop: Hop, options: Required<LinkCheckOptions>): Promise<LinkOutcome> {
	const { url } = hop

	if (url.protocol !== 'http:' && url.protocol !== 'https:') {
		return { ok: false, reason: `${url.protocol} is not http or https` }
	}

	const addresses = await addressesOf(url.hostname, options.lookup)

	if (addresses.length === 0 || !addresses.every((address) => isPublicAddress(address))) {
		return { ok: false, reason: `${url.hostname} is not a public address` }
	}

	let response = await request(url, 'HEAD', options)

	// Some servers refuse HEAD; a GET tells whether the page is there.
	if (response.status === 405 || response.status === 501 || response.status === 403) {
		response = await request(url, 'GET', options)
	}

	const location = response.headers.get('location')

	if (response.status >= 300 && response.status < 400 && location !== null) {
		if (hop.redirects >= maxRedirects) {
			return { ok: false, reason: 'too many redirects' }
		}

		return openHop({ url: new URL(location, url), redirects: hop.redirects + 1 }, options)
	}

	return response.ok ? { ok: true } : { ok: false, reason: `status ${response.status}` }
}

/** Opens one address, following redirects; any failure, timeout included, is a reason. */
export async function openLink(
	address: string,
	options: Required<LinkCheckOptions>,
): Promise<LinkOutcome> {
	if (!URL.canParse(address)) {
		return { ok: false, reason: 'not a URL' }
	}

	try {
		return await openHop({ url: new URL(address), redirects: 0 }, options)
	} catch (error) {
		return { ok: false, reason: error instanceof Error ? error.message : 'request failed' }
	}
}

/** Every link a card cites opens; `null` for a card without links. */
export async function checkLinks(
	links: readonly string[],
	{ lookup = bunLookup, fetch = globalThis.fetch, timeoutMs = 10_000 }: LinkCheckOptions = {},
): Promise<CheckResult | null> {
	if (links.length === 0) {
		return null
	}

	const options = { lookup, fetch, timeoutMs }

	const outcomes = await Promise.all(
		links.map(async (link) => ({ link, outcome: await openLink(link, options) })),
	)

	const failures = outcomes.flatMap(({ link, outcome }) =>
		outcome.ok ? [] : [`${link}: ${outcome.reason}`],
	)

	return failures.length === 0
		? { check: 'links', passed: true, detail: null }
		: { check: 'links', passed: false, detail: failures.join('; ') }
}
