// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

/*
 * Access decisions, made in one place (docs/principles.md, parallel-work rule 4): who is asking, what a
 * route lets through, and which requests come from another site. Routes declare their access with
 * `route` from ./http, pages read `Astro.locals.owner`, and nothing else reads cookies or tokens.
 */

/** The person the instance belongs to (D5). */
export interface Owner {
	readonly id: number
}

export type Access = 'public' | 'authorized'

/** Finds the owner behind a request (a session cookie, later a device token), or `null`. */
export type OwnerResolver = (request: Request) => Promise<Owner | null>

/** The stub until sign-in lands (SRV-4): nobody is signed in, so authorized routes answer 401. */
export async function resolveNobody(): Promise<Owner | null> {
	return null
}

export function isAllowed(access: Access, owner: Owner | null): boolean {
	return access === 'public' || owner !== null
}

const safeMethods = new Set(['GET', 'HEAD', 'OPTIONS'])

/**
 * Whether a request that changes something comes from another site and must be refused (CSRF, D6).
 * Browsers send `Sec-Fetch-Site` to secure origins and `Origin` on every cross-origin POST; over plain
 * HTTP to a LAN or tailnet name only `Origin` arrives, so it is compared with the public origin. A
 * sibling subdomain (`same-site`) is refused too. A request with neither header comes from a client
 * that is not a browser, such as a Shortcut with a device token, and is let through to its route.
 */
export function isCrossSite(request: Request, publicOrigin: string): boolean {
	if (safeMethods.has(request.method)) {
		return false
	}

	const site = request.headers.get('sec-fetch-site')

	if (site !== null) {
		return site !== 'same-origin' && site !== 'none'
	}

	const origin = request.headers.get('origin')

	return origin !== null && origin !== publicOrigin
}
