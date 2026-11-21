// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

/*
 * An in-memory CacheStorage for specs of the service worker: keeps the order caches were created in,
 * as browsers do, and matches by URL. Vary is never consulted, as with `ignoreVary: true`.
 */
import type { CacheLike, CacheStorageLike } from '#/lib/offline/env'

interface FakeCache extends CacheLike {
	readonly entries: Map<string, Response>
}

export interface FakeCacheStorage extends CacheStorageLike {
	readonly stores: Map<string, FakeCache>
	/** The URLs stored in a cache, or an empty list when it does not exist. */
	urls: (name: string) => string[]
}

function createFakeCache(): FakeCache {
	const entries = new Map<string, Response>()

	return {
		entries,

		async put(request, response) {
			entries.set(request, response)

			await Promise.resolve()
		},

		async match(request) {
			await Promise.resolve()

			return entries.get(request)?.clone()
		},

		async keys() {
			await Promise.resolve()

			return [...entries.keys()].map((url) => ({ url }))
		},
	}
}

export function createFakeCacheStorage(): FakeCacheStorage {
	const stores = new Map<string, FakeCache>()

	return {
		stores,

		async open(name) {
			await Promise.resolve()

			const existing = stores.get(name)

			if (existing !== undefined) {
				return existing
			}

			const created = createFakeCache()

			stores.set(name, created)

			return created
		},

		async keys() {
			await Promise.resolve()

			return [...stores.keys()]
		},

		async delete(name) {
			await Promise.resolve()

			return stores.delete(name)
		},

		urls(name) {
			return [...(stores.get(name)?.entries.keys() ?? [])]
		},
	}
}
