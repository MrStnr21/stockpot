// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { assetsCacheName, type WorkerEnv } from './env'
import { dropPages, fetchPage, isSignedOut, storePage } from './pages'
import { isStorablePage, pagesCacheName, staleAssetCaches } from './policy'

async function storedPaths(env: WorkerEnv): Promise<string[]> {
	const names = await env.caches.keys()

	if (!names.includes(pagesCacheName)) {
		return []
	}

	const pages = await env.caches.open(pagesCacheName)
	const requests = await pages.keys()

	return requests.map((request) => new URL(request.url).pathname)
}

/**
 * Renews every stored page from the network, and Today, so the first visit is kept too. Returns
 * whether every page was renewed; a session that is gone empties the pages and counts as done.
 */
async function renewPages(env: WorkerEnv): Promise<boolean> {
	const paths = new Set(['/', ...(await storedPaths(env))])
	let renewed = true

	for (const path of paths) {
		// oxlint-disable-next-line eslint/no-await-in-loop -- A page or two, one after the other, each with its own time limit.
		const answer = await fetchPage(env, path, { cache: 'reload', timeoutMs: env.renewTimeoutMs })

		if (isSignedOut(answer)) {
			// oxlint-disable-next-line eslint/no-await-in-loop -- Ends the loop.
			await dropPages(env)

			return true
		}

		if (answer.kind === 'page' && isStorablePage(answer.response)) {
			// oxlint-disable-next-line eslint/no-await-in-loop -- Each page is stored before the next is asked for.
			await storePage(env, path, answer.response)
		} else {
			renewed = false
		}
	}

	return renewed
}

/**
 * Drops the old builds' assets only once every stored page was renewed, so a stored page never
 * points at a file that is gone; after a failed renewal they stay, and assets are served from them.
 */
export async function activateWorker(env: WorkerEnv): Promise<void> {
	const renewed = await renewPages(env)
	const names = await env.caches.keys()

	await Promise.all(
		staleAssetCaches(names, assetsCacheName(env), renewed).map(async (name) =>
			env.caches.delete(name),
		),
	)
}
