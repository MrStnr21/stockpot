// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

/*
 * Sign-in backoff (D6). Three wrong passwords in a row are free, for typos; after that each attempt
 * waits twice as long as the one before, from 1 second up to 5 minutes, and an hour without a wrong
 * password forgets them. Sessions that are already signed in are not affected at all.
 *
 * Each counter is kept per known browser (./browsers.ts): a browser the owner signed in from before
 * counts its own wrong passwords, so a stranger who keeps the shared counter at its longest wait
 * cannot keep the owner out. Every request without a known browser shares one counter, which caps
 * guessing for the whole instance. Addresses are not used: behind a proxy or a tailnet, or with IPv6,
 * they say little about who is asking. Counters live in memory and start again on a restart, which
 * only someone with access to the machine can cause.
 */
export const freeAttempts = 3

export const firstWait = 1000

export const longestWait = 5 * 60 * 1000

export const forgetAfter = 60 * 60 * 1000

export interface Backoff {
	/** Milliseconds until the next attempt may be checked; 0 when it may be now. */
	readonly wait: (now?: number) => number
	/**
	 * Counts an attempt as failed before it is checked, so requests sent in parallel cannot all pass
	 * the wait; `succeed` forgives it.
	 */
	readonly fail: (now?: number) => void
	readonly succeed: () => void
}

interface Failures {
	count: number
	lastAt: number
}

export function createBackoff(): Backoff {
	const failures: Failures = { count: 0, lastAt: 0 }

	function forgetOld(now: number) {
		if (now - failures.lastAt >= forgetAfter) {
			failures.count = 0
		}
	}

	return {
		wait(now = Date.now()) {
			forgetOld(now)

			if (failures.count < freeAttempts) {
				return 0
			}

			const delay = Math.min(firstWait * 2 ** (failures.count - freeAttempts), longestWait)

			return Math.max(failures.lastAt + delay - now, 0)
		},

		fail(now = Date.now()) {
			forgetOld(now)
			failures.count += 1
			failures.lastAt = now
		},

		succeed() {
			failures.count = 0
		},
	}
}
