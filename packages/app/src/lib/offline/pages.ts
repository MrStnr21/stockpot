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
async function markedOffline(response: Response): Promise<Response> {
	const headers = new Headers(response.headers)

	headers.delete('content-length')
	headers.delete('content-encoding')

	return new Response(markOffline(await response.text()), {
		status: response.status,
		statusText: response.statusText,
		headers,
	})
}

async function offlinePage(env: WorkerEnv): Promise<Response> {
	const stored = await findAsset(env, offlinePath)

	if (stored === undefined) {
		return new Response('Offline', { status: 503, headers: { 'content-type': 'text/plain' } })
	}

	return markedOffline(stored)
}

async function storedPageOrOffline(env: WorkerEnv, path: string): Promise<Response> {
	const pages = await env.caches.open(pagesCacheName)
	const stored = await pages.match(pageUrl(env, path), { ignoreVary: true })

	return stored === undefined ? offlinePage(env) : markedOffline(stored)
}

/** Today and the notes: the network first, and the stored copy when it fails or is slow. */
export async function servePage(
	env: WorkerEnv,
	path: string,
	keepAlive: KeepAlive,
): Promise<Response> {
	const answer = await fetchPage(env, path, { cache: 'no-cache', timeoutMs: env.timeoutMs })

	if (answer.kind === 'failed') {
		return storedPageOrOffline(env, path)
	}

	if (answer.kind === 'redirect') {
		// The session is gone: nothing private stays, and the redirect is never stored.
		if (isSignedOut(answer)) {
			await dropPages(env)
		}

		return Response.redirect(answer.to, 302)
	}

	if (isStorablePage(answer.response)) {
		keepAlive(storePage(env, path, answer.response.clone()))
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

/** The sign-out form: the stored pages go first, so a signed-out device keeps none. */
export async function serveSignOut(env: WorkerEnv, request: Request): Promise<Response> {
	try {
		await dropPages(env)
	} catch {
		// The sign-out itself must still go through.
	}

	return env.fetch(request)
}
