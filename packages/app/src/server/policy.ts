// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

/*
 * Access decisions, made in one place (docs/principles.md, parallel-work rule 4): who is asking, what a
 * route lets through, and which requests come from another site. Routes declare their access with
 * `route` from ./http, pages read `Astro.locals.owner`, and nothing but ./auth reads cookies or tokens.
 */

/** The person the instance belongs to (D5), and how the request signed them in. */
export interface Owner {
	readonly id: number
	/** `session` for the web app's session cookie, `device` for a device token (SRV-5). */
	readonly via: 'session' | 'device'
}

/** Anyone; the owner signed in either way; or only the owner signed in with a web session. */
export type Access = 'public' | 'authorized' | 'session'

/** Cookie attributes: the subset of Astro's cookie options that sessions use. */
export interface CookieOptions {
	readonly path?: string
	readonly httpOnly?: boolean
	readonly secure?: boolean
	readonly sameSite?: 'lax' | 'strict'
	/** Seconds until the browser drops the cookie. */
	readonly maxAge?: number
}

/** The cookies of a request and its response; `Astro.cookies` is one. */
export interface CookieJar {
	readonly get: (name: string) => { readonly value: string } | undefined
	readonly set: (name: string, value: string, options: CookieOptions) => void
	readonly delete: (name: string, options: Omit<CookieOptions, 'maxAge'>) => void
}

export interface ResolverContext {
	readonly request: Request
	/** Read for the session cookie, and written when the resolver replaces it. */
	readonly cookies: CookieJar
}

/**
 * Finds the owner behind a request (a device token or a session cookie). `null` or `undefined`
 * means nobody; the middleware stores either as `null`.
 */
export type OwnerResolver = (context: ResolverContext) => Promise<Owner | null | undefined>

/**
 * Anything but an owner with an id, `undefined` and `{}` included, counts as signed out. `session`
 * also refuses a device token, so a stolen one cannot mint tokens or revoke the owner's devices.
 */
export function isAllowed(access: Access, owner: Owner | null | undefined): boolean {
	if (access === 'public') {
		return true
	}

	return Number.isInteger(owner?.id) && (access === 'authorized' || owner?.via === 'session')
}

const safeMethods = new Set(['GET', 'HEAD', 'OPTIONS'])

/**
 * Whether a session cookie may sign this request in. On a request that changes something it counts
 * only when the browser says where the request comes from (`Origin` or `Sec-Fetch-Site`), the headers
 * `isCrossSite` judges. A request with neither passes that check as a client that is not a browser,
 * so it must bring a device token (SRV-5): its cookie could have been attached by a browser that sent
 * no header to judge it by.
 */
export function mayUseCookie(request: Request): boolean {
	return (
		safeMethods.has(request.method) ||
		request.headers.has('origin') ||
		request.headers.has('sec-fetch-site')
	)
}

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
