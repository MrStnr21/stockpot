// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { assetsCacheName, pageUrl, type WorkerEnv } from './env'
import { assetCacheOrder } from './policy'

/** Stores the whole build; one missing file fails the install, so a half-filled cache is never current. */
export async function installAssets(env: WorkerEnv): Promise<void> {
	const cache = await env.caches.open(assetsCacheName(env))

	await Promise.all(
		env.precache.map(async (path) => {
			const response = await env.fetch(new Request(pageUrl(env, path), { cache: 'reload' }))

			if (!response.ok) {
				throw new Error(`Precache of ${path} answered ${response.status}`)
			}

			await cache.put(pageUrl(env, path), response)
		}),
	)
}

/** A stored file: from this build's cache, else from an older build's, newest first. */
export async function findAsset(env: WorkerEnv, path: string): Promise<Response | undefined> {
	const url = pageUrl(env, path)
	const current = await env.caches.open(assetsCacheName(env))
	const hit = await current.match(url, { ignoreVary: true })

	if (hit !== undefined) {
		return hit
	}

	// Older caches stay while a stored page may still point at the old build's files.
	const names = await env.caches.keys()

	for (const name of assetCacheOrder(names, assetsCacheName(env)).slice(1)) {
		// oxlint-disable-next-line eslint/no-await-in-loop -- Newest first, stopping at the first hit.
		const cache = await env.caches.open(name)
		// oxlint-disable-next-line eslint/no-await-in-loop -- Same.
		const found = await cache.match(url, { ignoreVary: true })

		if (found !== undefined) {
			return found
		}
	}

	return undefined
}

/** Any build's file: its cache, else an older build's, else the network. Nothing new is stored. */
export async function serveAsset(env: WorkerEnv, request: Request): Promise<Response> {
	const stored = await findAsset(env, new URL(request.url).pathname)

	return stored ?? env.fetch(request)
}
