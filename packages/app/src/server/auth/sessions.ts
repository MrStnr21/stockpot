// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { eq, lte } from 'drizzle-orm'

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
 * older than a day is replaced on the next request that carries it. The replaced token keeps working
 * for a minute, so the requests a page sent in parallel with it are not signed out halfway; after that
 * minute it is never accepted again, and presenting it ends every session. Two browsers holding one
 * token means it was copied, and whichever of them rotated first may be the thief, so both are signed
 * out. The cost: a browser that never received its new token, because the response was lost, signs the
 * owner out everywhere on its next request.
 *
 * A replaced row is recognised by its cut expiry (`expiresAt < createdAt + sessionLifetime`), and it is
 * kept until the token would have run out anyway, so reuse is caught for as long as it could matter.
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
	pruneSessions(context.db, now)
	startSession(context, now)
}

/** Deletes the rows of tokens past their 30 days, replaced ones included: nothing can reuse them now. */
function pruneSessions(db: Queryable, now: Date) {
	const issuedBefore = new Date(now.getTime() - sessionLifetime)

	db.delete(sessions).where(lte(sessions.createdAt, issuedBefore)).run()
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

interface SessionRow {
	readonly ownerId: number
	readonly tokenHash: string
	readonly createdAt: Date
	readonly expiresAt: Date
}

/** Replaces a token: its row is cut to the grace period, and a new token goes into the cookie. */
function rotate(context: SessionContext & { db: Db }, session: SessionRow, now: Date) {
	// Always below the natural expiry, so the row reads as replaced even in its last minute.
	const graceEnd = Math.min(
		now.getTime() + rotationGrace,
		session.createdAt.getTime() + sessionLifetime - 1,
	)

	context.db.transaction((tx) => {
		tx.update(sessions)
			.set({ expiresAt: new Date(graceEnd) })
			.where(eq(sessions.tokenHash, session.tokenHash))
			.run()
		startSession({ ...context, db: tx }, now)
	})
}

/**
 * The owner signed in by the request's cookie, or `null`. A token due for rotation is replaced, and a
 * replaced token is accepted only during its grace period, without being replaced again. A replaced
 * token presented after that has been copied, so every session ends.
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

	// Joined with the owner, so sessions left over from a deleted owner sign nobody in.
	const session = db
		.select({
			ownerId: owner.id,
			tokenHash: sessions.tokenHash,
			createdAt: sessions.createdAt,
			expiresAt: sessions.expiresAt,
		})
		.from(sessions)
		.crossJoin(owner)
		.where(eq(sessions.tokenHash, hashToken(token)))
		.get()

	if (session === undefined) {
		return null
	}

	const isReplaced = session.expiresAt.getTime() < session.createdAt.getTime() + sessionLifetime

	if (session.expiresAt <= now) {
		if (isReplaced) {
			endAllSessions(db)
		}

		return null
	}

	if (!isReplaced && now.getTime() - session.createdAt.getTime() >= rotationAge) {
		rotate(context, session, now)
	}

	return { id: session.ownerId }
}
