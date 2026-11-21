// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

/*
 * What the service worker's logic needs from the browser, passed in so specs can run it against
 * in-memory fakes. src/sw.ts passes the real caches, network and origin.
 */
import { assetsCachePrefix } from './policy'

/** The part of the Cache API the worker uses. */
export interface CacheLike {
	put: (request: string, response: Response) => Promise<void>
	match: (request: string, options?: { ignoreVary?: boolean }) => Promise<Response | undefined>
	keys: () => Promise<readonly { readonly url: string }[]>
}

/** The part of the CacheStorage API the worker uses. */
export interface CacheStorageLike {
	open: (name: string) => Promise<CacheLike>
	keys: () => Promise<string[]>
	delete: (name: string) => Promise<boolean>
}

export interface WorkerEnv {
	readonly caches: CacheStorageLike
	readonly fetch: (input: Request | string, init?: RequestInit) => Promise<Response>
	readonly origin: string
	/** Names the asset cache; a new build has a new one. */
	readonly version: string
	/** Paths of every file of the build, plus the offline page: what an install stores. */
	readonly precache: readonly string[]
	/** How long a page may take before its stored copy is served instead. */
	readonly timeoutMs: number
}

/** `event.waitUntil` for work that may outlive the response. */
export type KeepAlive = (work: Promise<unknown>) => void

export function pageUrl(env: WorkerEnv, path: string): string {
	return new URL(path, env.origin).href
}

export function assetsCacheName(env: WorkerEnv): string {
	return `${assetsCachePrefix}${env.version}`
}
