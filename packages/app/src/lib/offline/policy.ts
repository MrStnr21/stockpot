// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

/*
 * What the service worker may store and when it steps in. Pure functions, so the rules that decide
 * what private data stays on the device are specced without a browser.
 */

/** The pages kept for offline reading: the last Today and the recent notes. */
export const storedPaths: readonly string[] = ['/', '/notes']

export const offlinePath = '/offline'

export const signOutPath = '/signout'

export const signInPath = '/signin'

export const pagesCacheName = 'pages'

export const assetsCachePrefix = 'assets-'

/** The part of a request the worker looks at. */
export type RequestFacts = Pick<Request, 'method' | 'mode' | 'destination' | 'url'>

export type RequestKind = 'sign-out' | 'asset' | 'stored-page' | 'navigation' | 'ignored'

function isTopLevelNavigation(request: RequestFacts) {
	return request.mode === 'navigate' && request.destination === 'document'
}

/**
 * How the worker treats a request. Anything not named here goes straight to the network: API calls,
 * POSTs, other origins, subresources outside the precache list.
 */
export function classifyRequest(
	request: RequestFacts,
	origin: string,
	precached: ReadonlySet<string>,
): RequestKind {
	const url = new URL(request.url)

	if (url.origin !== origin) {
		return 'ignored'
	}

	if (request.method === 'POST' && isTopLevelNavigation(request) && url.pathname === signOutPath) {
		return 'sign-out'
	}

	if (request.method !== 'GET') {
		return 'ignored'
	}

	if (precached.has(url.pathname)) {
		return 'asset'
	}

	if (!isTopLevelNavigation(request)) {
		return 'ignored'
	}

	// A query string makes another page, and only the two plain URLs are kept.
	return storedPaths.includes(url.pathname) && url.search === '' ? 'stored-page' : 'navigation'
}

/** The facts of a response the storage rule reads. */
export type ResponseFacts = Pick<Response, 'ok' | 'status' | 'redirected' | 'type' | 'headers'>

/**
 * A page is stored only when it is a plain, successful HTML answer from this origin. A redirect, as
 * to sign-in once the session is gone, an error or an opaque answer is never kept, so none of
 * them can replace the last good copy.
 */
export function isStorablePage(response: ResponseFacts): boolean {
	return (
		response.ok &&
		response.status === 200 &&
		!response.redirected &&
		response.type === 'basic' &&
		(response.headers.get('content-type') ?? '').toLowerCase().startsWith('text/html')
	)
}

/** A proxy in front of a stopped server answers with these instead of failing the connection. */
export function isUnreachable(response: Pick<Response, 'status'>): boolean {
	return response.status === 502 || response.status === 503 || response.status === 504
}

const htmlTag = /<html(?=[\s>])[^>]*>/iu

/** Marks a stored page as shown offline, which turns the shell's banner on. */
export function markOffline(html: string): string {
	const tag = htmlTag.exec(html)?.[0]

	if (tag === undefined || /\sdata-connection=/iu.test(tag)) {
		return html
	}

	return html.replace(htmlTag, `${tag.slice(0, 5)} data-connection="offline"${tag.slice(5)}`)
}

/** The asset caches to delete: every old one, but only once every stored page was renewed. */
export function staleAssetCaches(
	cacheNames: readonly string[],
	current: string,
	pagesRenewed: boolean,
): string[] {
	return pagesRenewed
		? cacheNames.filter((name) => name.startsWith(assetsCachePrefix) && name !== current)
		: []
}

/** Asset caches in the order to search them: the current one, then the others newest first. */
export function assetCacheOrder(cacheNames: readonly string[], current: string): string[] {
	const others = cacheNames
		.filter((name) => name.startsWith(assetsCachePrefix) && name !== current)
		.toReversed()

	return [current, ...others]
}
