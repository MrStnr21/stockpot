// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

/*
 * Sign-in backoff (D6). Three wrong passwords in a row are free, for typos; after that each attempt
 * waits twice as long as the one before, from 1 second up to 5 minutes, and an hour without a wrong
 * password forgets them. The wait never grows past 5 minutes, so the owner is never locked out for
 * good, and sessions that are already signed in are not affected at all.
 *
 * The counter is one per instance, not per address: an instance has a single owner, and addresses
 * behind a proxy or a tailnet say little about who is asking. It lives in memory and starts again on a
 * restart, which only someone with access to the machine can cause.
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
