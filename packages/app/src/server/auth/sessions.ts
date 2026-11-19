// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { and, eq, gt, lte } from 'drizzle-orm'

import type { Db } from '#/server/db/client'
import { owner, sessions } from '#/server/db/schema/auth'
import type { CookieJar, CookieOptions, Owner } from '#/server/policy'

import { hashToken, randomToken } from './tokens'

/** The database or a transaction on it: the queries below run in either. */
export type Queryable = Pick<Db, 'delete' | 'insert' | 'select' | 'update'>

/** The session cookie of this instance: its name and whether it is sent only over HTTPS. */
export interface SessionCookie {
	readonly name: string
	readonly secure: boolean
}

/** What every session function works on: the database, the request's cookies and the cookie's name. */
export interface SessionContext {
	readonly db: Queryable
	readonly cookies: CookieJar
	readonly cookie: SessionCookie
}

const day = 24 * 60 * 60 * 1000

/*
 * A token lasts 30 days, so the owner stays signed in on a phone opened at least once a month. A token
 * older than a day is replaced on the next request that carries it, which keeps an active session
 * going while a stolen cookie stops working once the owner's own browser comes by again. The replaced
 * token keeps working for a minute, so the requests a page sent in parallel with it are not signed out
 * halfway.
 */
export const sessionLifetime = 30 * day

export const rotationAge = day

export const rotationGrace = 60 * 1000

/**
 * Over HTTPS the cookie takes the `__Host-` prefix: browsers then accept it only when it is `Secure`,
 * on `/` and without a `Domain`, so no other host, a sibling subdomain included, can set it.
 */
export function sessionCookie(publicOrigin: string): SessionCookie {
	const secure = new URL(publicOrigin).protocol === 'https:'

	return { name: secure ? '__Host-stockpot_session' : 'stockpot_session', secure }
}

/* `HttpOnly` keeps the token away from scripts; `Lax` keeps it off the requests other sites send,
 * except top-level navigations, which only read. */
function cookieOptions({ secure }: SessionCookie): CookieOptions {
	return { path: '/', httpOnly: true, sameSite: 'lax', secure }
}

// A token from randomToken(): 32 bytes as base64url, without padding.
const tokenPattern = /^[\w-]{43}$/u

/** The token in the request's cookie, when it has the shape of one. */
function cookieToken({ cookies, cookie }: SessionContext) {
	const token = cookies.get(cookie.name)?.value

	return token !== undefined && tokenPattern.test(token) ? token : undefined
}

/** Starts a session: stores the hash of a new token and sends the token in the cookie. */
export function startSession(context: SessionContext, now = new Date()): void {
	const { db, cookies, cookie } = context
	const token = randomToken()
	const expiresAt = new Date(now.getTime() + sessionLifetime)

	db.insert(sessions)
		.values({ tokenHash: hashToken(token), createdAt: now, expiresAt })
		.run()
	cookies.set(cookie.name, token, { ...cookieOptions(cookie), maxAge: sessionLifetime / 1000 })
}

/** Deletes the session of the request's cookie, if it carries one. */
function deleteCookieSession(context: SessionContext) {
	const token = cookieToken(context)

	if (token !== undefined) {
		context.db
			.delete(sessions)
			.where(eq(sessions.tokenHash, hashToken(token)))
			.run()
	}
}

/**
 * Starts the session of a sign-in. The session in the request's cookie, if any, ends at once, so a
 * token planted in the browser before sign-in never becomes a signed-in one; sessions that have run out
 * go too, so the table never grows for long.
 */
export function replaceSession(context: SessionContext, now = new Date()): void {
	deleteCookieSession(context)
	context.db.delete(sessions).where(lte(sessions.expiresAt, now)).run()
	startSession(context, now)
}

/** Ends the session in the request's cookie, if any, and tells the browser to drop the cookie. */
export function endSession(context: SessionContext): void {
	deleteCookieSession(context)
	context.cookies.delete(context.cookie.name, cookieOptions(context.cookie))
}

/** Ends every session, as creating an owner does. */
export function endAllSessions(db: Queryable): void {
	db.delete(sessions).run()
}

/**
 * The owner signed in by the request's cookie, or `null`. A token due for rotation is replaced: the new
 * one goes into the cookie, and the old one runs out after `rotationGrace`. A token already cut to its
 * grace period has been replaced, so it is not replaced again.
 */
export function resolveSession(
	context: SessionContext & { db: Db },
	now = new Date(),
): Owner | null {
	const token = cookieToken(context)

	if (token === undefined) {
		return null
	}

	const { db } = context
	const tokenHash = hashToken(token)

	// Joined with the owner, so sessions left over from a deleted owner sign nobody in.
	const session = db
		.select({ ownerId: owner.id, createdAt: sessions.createdAt, expiresAt: sessions.expiresAt })
		.from(sessions)
		.crossJoin(owner)
		.where(and(eq(sessions.tokenHash, tokenHash), gt(sessions.expiresAt, now)))
		.get()

	if (session === undefined) {
		return null
	}

	const isDue = now.getTime() - session.createdAt.getTime() >= rotationAge
	const isReplaced = session.expiresAt.getTime() - now.getTime() <= rotationGrace

	if (isDue && !isReplaced) {
		db.transaction((tx) => {
			tx.update(sessions)
				.set({ expiresAt: new Date(now.getTime() + rotationGrace) })
				.where(eq(sessions.tokenHash, tokenHash))
				.run()
			startSession({ ...context, db: tx }, now)
		})
	}

	return { id: session.ownerId }
}
