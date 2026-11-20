// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { dns } from 'bun'

import { abortReason } from '#/server/engines/runs'

import { isIpLiteral, isPublicAddress } from './addresses'

export type Lookup = (hostname: string) => Promise<readonly string[]>

export type Fetch = (url: string, init: BunFetchRequestInit) => Promise<Response>

export interface LinkCheckOptions {
	readonly lookup?: Lookup
	readonly fetch?: Fetch
	readonly timeoutMs?: number
	readonly signal?: AbortSignal
}

export type LinkOutcome =
	| { readonly kind: 'open'; readonly status: number }
	| { readonly kind: 'dead'; readonly reason: string }
	| { readonly kind: 'refused'; readonly reason: string }

interface LinkContext {
	readonly lookup: Lookup
	readonly fetch: Fetch
	readonly signal: AbortSignal
}

const maxRedirects = 5

const retryWithGet = new Set([400, 403, 405, 501])

const browserStatuses = new Set([401, 403, 429])

async function bunLookup(hostname: string): Promise<string[]> {
	const records = await dns.lookup(hostname)

	return records.map(({ address }) => address)
}

function pinnedUrl(hop: URL, address: string): URL | null {
	if (!isPublicAddress(address)) {
		return null
	}

	const host = address.includes(':') ? `[${address}]` : address
	const pinned = new URL(hop.href)

	pinned.hostname = host
	pinned.hash = ''

	/* The hostname setter can silently ignore invalid input. Compare canonical literals so
	 * equivalent spellings of an IPv6 address still work. */
	const expected = URL.parse(`http://${host}/`)?.hostname

	return pinned.hostname === expected && isIpLiteral(pinned.hostname) ? pinned : null
}

async function request(
	url: URL,
	init: BunFetchRequestInit,
	context: LinkContext,
): Promise<Response> {
	context.signal.throwIfAborted()

	const response = await context.fetch(url.href, init)

	// Only the headers matter. An uncooperative body must not hold up the result.
	response.body?.cancel().catch(() => null)

	return response
}

async function requestAt(
	url: URL,
	init: BunFetchRequestInit,
	context: LinkContext,
): Promise<Response> {
	const head = await request(url, { ...init, method: 'HEAD' }, context)

	return retryWithGet.has(head.status) ? request(url, { ...init, method: 'GET' }, context) : head
}

async function requestHop(hop: URL, context: LinkContext): Promise<Response | LinkOutcome> {
	const literal = isIpLiteral(hop.hostname)

	const addresses = literal
		? [hop.hostname.replaceAll(/^\[|\]$/gu, '')]
		: await context.lookup(hop.hostname)

	const targets: URL[] = []

	for (const address of addresses) {
		const target = pinnedUrl(hop, address)

		if (target === null) {
			return { kind: 'refused', reason: `${hop.hostname} is not a public address` }
		}

		targets.push(target)
	}

	const init: BunFetchRequestInit = {
		headers: { Host: hop.host },
		...(hop.protocol === 'https:' && !literal && { tls: { serverName: hop.hostname } }),
		redirect: 'manual',
		signal: context.signal,
	}

	const ordered = targets.toSorted(
		(a, b) => Number(a.hostname.startsWith('[')) - Number(b.hostname.startsWith('[')),
	)

	let reason = 'no addresses'

	for (const target of ordered) {
		try {
			// oxlint-disable-next-line no-await-in-loop -- A second address is tried only after the first connection fails.
			return await requestAt(target, init, context)
		} catch (error) {
			context.signal.throwIfAborted()
			reason = error instanceof Error ? error.message : 'request failed'
		}
	}

	return { kind: 'dead', reason }
}

async function openHop(hop: URL, redirects: number, context: LinkContext): Promise<LinkOutcome> {
	context.signal.throwIfAborted()

	if (hop.protocol !== 'http:' && hop.protocol !== 'https:') {
		return { kind: 'refused', reason: `${hop.protocol} is not http or https` }
	}

	if (hop.username !== '' || hop.password !== '') {
		return { kind: 'refused', reason: 'URL contains credentials' }
	}

	const response = await requestHop(hop, context)

	if ('kind' in response) {
		return response
	}

	const { status } = response

	if (status >= 300 && status < 400) {
		const location = response.headers.get('location')?.trim() ?? ''
		const next = location === '' ? null : URL.parse(location, hop)

		if (next === null) {
			return { kind: 'dead', reason: `status ${status} without a usable Location` }
		}

		return redirects >= maxRedirects
			? { kind: 'dead', reason: 'too many redirects' }
			: openHop(next, redirects + 1, context)
	}

	return response.ok || browserStatuses.has(status)
		? { kind: 'open', status }
		: { kind: 'dead', reason: `status ${status}` }
}

export async function openLink(
	address: string,
	options: LinkCheckOptions = {},
): Promise<LinkOutcome> {
	const caller = options.signal

	const deadline = AbortSignal.timeout(options.timeoutMs ?? 10_000)
	const signal = caller ? AbortSignal.any([deadline, caller]) : deadline

	const context = {
		lookup: options.lookup ?? bunLookup,
		fetch: options.fetch ?? globalThis.fetch,
		signal,
	}

	// DNS and injected transports may still be pending when the caller stops or the deadline expires.
	const stopped = Promise.withResolvers<never>()

	function onAbort() {
		stopped.reject(abortReason(signal))
	}

	signal.addEventListener('abort', onAbort, { once: true })

	try {
		signal.throwIfAborted()

		const url = URL.parse(address)

		if (url === null) {
			return { kind: 'refused', reason: 'not a URL' }
		}

		const outcome = await Promise.race([openHop(url, 0, context), stopped.promise])

		signal.throwIfAborted()

		return outcome
	} catch (error) {
		if (caller?.aborted === true) {
			throw abortReason(caller)
		}

		if (deadline.aborted) {
			return { kind: 'dead', reason: 'timed out' }
		}

		return { kind: 'dead', reason: error instanceof Error ? error.message : 'request failed' }
	} finally {
		signal.removeEventListener('abort', onAbort)
	}
}
