// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import type { CookieJar, CookieOptions } from '#/server/policy'

export interface SentCookie {
	readonly value: string
	readonly options: CookieOptions
}

/** A cookie jar for specs: `carried` is what the request brought, `sent` what the response sets. */
export interface TestCookieJar extends CookieJar {
	readonly carried: Readonly<Record<string, string>>
	/** Each cookie the response sets, by name; a deleted one has an empty value. */
	readonly sent: Map<string, SentCookie>
}

/** Behaves like `Astro.cookies`: a cookie set or deleted during the request reads back as such. */
export function createCookieJar(carried: Record<string, string> = {}): TestCookieJar {
	const sent = new Map<string, SentCookie>()

	return {
		carried,
		sent,
		get(name) {
			const value = sent.has(name) ? sent.get(name)?.value : carried[name]

			return value === undefined || value === '' ? undefined : { value }
		},
		set(name, value, options) {
			sent.set(name, { value, options })
		},
		delete(name, options) {
			sent.set(name, { value: '', options })
		},
	}
}

/** The jar of the next request: the cookies the browser holds after the previous response. */
export function nextRequestCookies(previous: TestCookieJar): TestCookieJar {
	const held = new Map(Object.entries(previous.carried))

	for (const [name, { value }] of previous.sent) {
		if (value === '') {
			held.delete(name)
		} else {
			held.set(name, value)
		}
	}

	return createCookieJar(Object.fromEntries(held))
}
