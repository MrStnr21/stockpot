// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

/*
 * Known browsers, the "device cookie" defence against password guessing (OWASP). A browser that signs
 * in gets a long-lived cookie, stored only as a hash. It never signs anyone in by itself: it only lets
 * sign-in backoff count that browser's wrong passwords apart, so a stranger guessing passwords cannot
 * keep the owner's own browser waiting.
 */
import { and, eq, gt, lte } from 'drizzle-orm'

import { browsers } from '#/server/db/schema/auth'

import { asToken, cookieOptions, type SessionContext } from './sessions'
import { hashToken, randomToken } from './tokens'

/** A browser not seen for a year is forgotten: its row is pruned and its cookie has run out. */
export const browserLifetime = 365 * 24 * 60 * 60 * 1000

export interface KnownBrowser {
	readonly token: string
	readonly tokenHash: string
}

function cutoff(now: Date) {
	return new Date(now.getTime() - browserLifetime)
}

/** The known browser behind the request's browser cookie, or `undefined`. */
export function knownBrowser(context: SessionContext, now = new Date()): KnownBrowser | undefined {
	const token = asToken(context.cookies.get(context.cookie.name)?.value)

	if (token === undefined) {
		return undefined
	}

	const tokenHash = hashToken(token)
	const isRecent = gt(browsers.lastSeenAt, cutoff(now))

	const row = context.db
		.select({ tokenHash: browsers.tokenHash })
		.from(browsers)
		.where(and(eq(browsers.tokenHash, tokenHash), isRecent))
		.get()

	return row === undefined ? undefined : { token, tokenHash }
}

function sendCookie(context: SessionContext, token: string) {
	context.cookies.set(context.cookie.name, token, {
		...cookieOptions(context.cookie),
		maxAge: browserLifetime / 1000,
	})
}

/**
 * Marks the browser as seen, on a sign-in or a session rotation: a known one keeps its token for
 * another year, any other gets a new one. Browsers not seen for a year are pruned.
 */
export function rememberBrowser(context: SessionContext, now = new Date()): void {
	const { db } = context
	const known = knownBrowser(context, now)

	db.delete(browsers)
		.where(lte(browsers.lastSeenAt, cutoff(now)))
		.run()

	if (known === undefined) {
		const token = randomToken()

		db.insert(browsers)
			.values({ tokenHash: hashToken(token), createdAt: now, lastSeenAt: now })
			.run()
		sendCookie(context, token)

		return
	}

	db.update(browsers).set({ lastSeenAt: now }).where(eq(browsers.tokenHash, known.tokenHash)).run()
	sendCookie(context, known.token)
}
