// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

/*
 * Pages are private: only Today and the notes are stored, only a plain good answer is kept, and
 * everything is dropped when the owner signs out or the session is gone.
 */
import { findAsset } from './assets'
import { pageUrl, type KeepAlive, type WorkerEnv } from './env'
import {
	isStorablePage,
	isUnreachable,
	markOffline,
	offlinePath,
	pagesCacheName,
	referencedAssets,
	signInPath,
} from './policy'

export type PageAnswer =
	| { readonly kind: 'page'; readonly response: Response }
	| { readonly kind: 'redirect'; readonly to: string }
	| { readonly kind: 'failed' }

/** Asks the network for a page with the owner's cookies, following redirects to learn where they lead. */
export async function fetchPage(
	env: WorkerEnv,
	path: string,
	{ cache, timeoutMs }: { cache: RequestCache; timeoutMs: number | null },
): Promise<PageAnswer> {
	const controller = new AbortController()

	const timer =
		timeoutMs === null
			? null
			: setTimeout(() => {
					controller.abort()
				}, timeoutMs)

	try {
		const response = await env.fetch(pageUrl(env, path), {
			cache,
			credentials: 'same-origin',
			redirect: 'follow',
			headers: { accept: 'text/html' },
			signal: controller.signal,
		})

		if (response.redirected) {
			return { kind: 'redirect', to: response.url }
		}

		return isUnreachable(response) ? { kind: 'failed' } : { kind: 'page', response }
	} catch {
		return { kind: 'failed' }
	} finally {
		if (timer !== null) {
			clearTimeout(timer)
		}
	}
}

export async function storePage(env: WorkerEnv, path: string, response: Response): Promise<void> {
	const pages = await env.caches.open(pagesCacheName)

	await pages.put(pageUrl(env, path), response)
}

export async function dropPages(env: WorkerEnv): Promise<void> {
	await env.caches.delete(pagesCacheName)
}

/** Whether an answer says the session is gone: a redirect that ends on the sign-in page. */
export function isSignedOut(answer: PageAnswer): boolean {
	return answer.kind === 'redirect' && new URL(answer.to).pathname === signInPath
}

/** A copy with the offline marker in its `<html>` tag; the body is decoded, so its length and encoding headers go. */
async function markedOffline(response: Response, status = response.status): Promise<Response> {
	const headers = new Headers(response.headers)

	headers.delete('content-length')
	headers.delete('content-encoding')

	return new Response(markOffline(await response.text()), { status, headers })
}

/** The stored offline page, marked offline; `status` says what the request itself came to. */
export async function offlinePage(env: WorkerEnv, status = 200): Promise<Response> {
	const stored = await findAsset(env, offlinePath).catch(() => null)

	if (stored === undefined || stored === null) {
		return new Response('Offline', { status: 503, headers: { 'content-type': 'text/plain' } })
	}

	return markedOffline(stored, status)
}

async function storedPage(env: WorkerEnv, path: string): Promise<Response | undefined> {
	// Opening the cache would create it, and a signed-out device keeps no pages cache at all.
	const names = await env.caches.keys()

	if (!names.includes(pagesCacheName)) {
		return undefined
	}

	const pages = await env.caches.open(pagesCacheName)

	return pages.match(pageUrl(env, path), { ignoreVary: true })
}

/**
 * A copy is kept only when every build file it names is held by some asset cache: this worker may be
 * older than the server, and such a copy would show unstyled offline. The previous copy stays, and
 * the browser is asked for the newer worker.
 */
async function storeIfServable(env: WorkerEnv, path: string, response: Response): Promise<void> {
	const wanted = referencedAssets(await response.clone().text())
	const found = await Promise.all(wanted.map(async (asset) => findAsset(env, asset)))

	if (found.includes(undefined)) {
		await env.update().catch(() => null)

		return
	}

	await storePage(env, path, response)
}

/*
 * Today and the notes: the network first, and the stored copy when it fails or is slow. Without a
 * stored copy a slow server is waited for, since the offline page would be no better than waiting.
 *
 * Known and accepted: the stored copy is also shown when the server is slow or answers 502 to 504,
 * even if the session has expired meanwhile. It is the owner's own device, and the copy is dropped
 * at the next answer that redirects to sign-in.
 */
export async function servePage(
	env: WorkerEnv,
	path: string,
	keepAlive: KeepAlive,
): Promise<Response> {
	const stored = await storedPage(env, path)

	const answer = await fetchPage(env, path, {
		cache: 'no-cache',
		timeoutMs: stored === undefined ? null : env.timeoutMs,
	})

	if (answer.kind === 'failed') {
		return stored === undefined ? offlinePage(env) : markedOffline(stored)
	}

	if (answer.kind === 'redirect') {
		// The session is gone: nothing private stays, and the redirect is never stored.
		if (isSignedOut(answer)) {
			await dropPages(env)
		}

		return Response.redirect(answer.to, 302)
	}

	if (isStorablePage(answer.response)) {
		keepAlive(storeIfServable(env, path, answer.response.clone()))
	}

	return answer.response
}

/** Any other page: the network only, and the offline page when it fails. */
export async function serveNavigation(env: WorkerEnv, request: Request): Promise<Response> {
	try {
		const response = await env.fetch(request)

		return isUnreachable(response) ? await offlinePage(env) : response
	} catch {
		return offlinePage(env)
	}
}

/**
 * The sign-out form: the stored pages go first, so a signed-out device keeps none. When the server
 * cannot be reached the session survives, and the owner is told so instead of seeing a browser error.
 */
export async function serveSignOut(env: WorkerEnv, request: Request): Promise<Response> {
	try {
		await dropPages(env)
	} catch {
		// The sign-out itself must still go through.
	}

	try {
		return await env.fetch(request)
	} catch {
		return offlinePage(env, 503)
	}
}
