// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

/*
 * The "links open" check (docs/engines.md, "Links"): every address a card cites must answer, and none
 * may lead to a loopback, private or link-local address once DNS is resolved, redirects included.
 * The server's own link check (RES-2) will also cap the size it reads; a HEAD request reads nothing,
 * and a GET fallback cancels the body at once.
 */
import { dns } from 'bun'

import { abortReason } from '#/server/engines/runs'

import { isIpLiteral, isPublicAddress } from './addresses'
import type { CheckResult } from './checks'

export type Lookup = (hostname: string) => Promise<readonly string[]>

export type Fetch = (url: string, init: RequestInit) => Promise<Response>

export interface LinkCheckOptions {
	readonly lookup?: Lookup
	readonly fetch?: Fetch
	/** One deadline per link, covering DNS, every redirect and the GET fallback. */
	readonly timeoutMs?: number
	/** Stops every check early, as when the run is stopped. */
	readonly signal?: AbortSignal
}

interface LinkContext {
	readonly lookup: Lookup
	readonly fetch: Fetch
	/** Aborts at the link's deadline. */
	readonly signal: AbortSignal
}

/** Settles as `work` does, or rejects once `signal` aborts, whichever comes first. */
async function beforeDeadline<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
	signal.throwIfAborted()

	const deadline = Promise.withResolvers<never>()

	function onAbort(): void {
		deadline.reject(abortReason(signal))
	}

	signal.addEventListener('abort', onAbort, { once: true })

	try {
		return await Promise.race([work, deadline.promise])
	} finally {
		signal.removeEventListener('abort', onAbort)
	}
}

const maxRedirects = 5

async function bunLookup(hostname: string): Promise<string[]> {
	const records = await dns.lookup(hostname)

	return records.map(({ address }) => address)
}

async function addressesOf(hostname: string, context: LinkContext): Promise<readonly string[]> {
	const literal = hostname.replaceAll(/^\[|\]$/gu, '')

	if (isIpLiteral(literal)) {
		return [literal]
	}

	return beforeDeadline(context.lookup(hostname), context.signal)
}

interface Hop {
	readonly url: URL
	readonly redirects: number
}

type LinkOutcome = { readonly ok: true } | { readonly ok: false; readonly reason: string }

async function request(url: URL, method: string, { fetch, signal }: LinkContext) {
	const response = await fetch(url.href, { method, redirect: 'manual', signal })

	await response.body?.cancel()

	return response
}

async function openHop(hop: Hop, options: LinkContext): Promise<LinkOutcome> {
	const { url } = hop

	if (url.protocol !== 'http:' && url.protocol !== 'https:') {
		return { ok: false, reason: `${url.protocol} is not http or https` }
	}

	const addresses = await addressesOf(url.hostname, options)

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

interface LinkSettings {
	readonly lookup: Lookup
	readonly fetch: Fetch
	readonly timeoutMs: number
	readonly signal: AbortSignal | undefined
}

/** Opens one address, following redirects; any failure, the deadline included, is a reason. */
export async function openLink(address: string, settings: LinkSettings): Promise<LinkOutcome> {
	if (!URL.canParse(address)) {
		return { ok: false, reason: 'not a URL' }
	}

	const deadline = AbortSignal.timeout(settings.timeoutMs)
	const signal = settings.signal ? AbortSignal.any([deadline, settings.signal]) : deadline
	const context = { lookup: settings.lookup, fetch: settings.fetch, signal }

	try {
		return await openHop({ url: new URL(address), redirects: 0 }, context)
	} catch (error) {
		return { ok: false, reason: error instanceof Error ? error.message : 'request failed' }
	}
}

/** Every link a card cites opens; `null` for a card without links. */
export async function checkLinks(
	links: readonly string[],
	{
		lookup = bunLookup,
		fetch = globalThis.fetch,
		timeoutMs = 10_000,
		signal,
	}: LinkCheckOptions = {},
): Promise<CheckResult | null> {
	if (links.length === 0) {
		return null
	}

	const options = { lookup, fetch, timeoutMs, signal }

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
