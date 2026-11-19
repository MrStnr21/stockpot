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

/** Whether an IP address may be fetched: not loopback, private, link-local or reserved. */
export function isPublicAddress(address: string): boolean {
	const ip = address.replaceAll(/^\[|\]$/gu, '').toLowerCase()
	const v4 = ipv4Parts(ip)

	if (v4 !== null) {
		return isPublicIpv4(v4)
	}

	if (!ip.includes(':')) {
		return false
	}

	const mapped = /^::ffff:(?<v4>[\d.]+)$/u.exec(ip)?.groups?.v4

	if (mapped !== undefined) {
		return isPublicAddress(mapped)
	}

	// Unspecified, loopback, unique local (fc00::/7) and link-local (fe80::/10).
	return ip !== '::' && ip !== '::1' && !/^f[cd]/u.test(ip) && !/^fe[89ab]/u.test(ip)
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
