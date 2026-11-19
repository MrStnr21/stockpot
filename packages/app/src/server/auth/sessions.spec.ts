// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { $ } from 'bun'
import { afterEach, beforeEach, describe, expect, it, setSystemTime } from 'bun:test'
import { join } from 'node:path'
import { createCookieJar, nextRequestCookies, type TestCookieJar } from '#tests/setup/cookies'
import { createTestDb, migrationsFolder, type TestDb } from '#tests/setup/db'

import { openDatabase } from '#/server/db/client'

import { insertOwner } from './owner'
import {
	resolveSession,
	rotationAge,
	rotationGrace,
	sessionCookie,
	sessionLifetime,
	startSession,
} from './sessions'

const cookie = sessionCookie('http://127.0.0.1:4321')

const start = new Date('2026-11-19T12:00:00Z')

// Sessions need an owner to sign in; the hash is never checked here.
const passwordHash = '$argon2id$v=19$m=65536,t=2,p=1$placeholder'

function later(milliseconds: number) {
	return new Date(start.getTime() + milliseconds)
}

describe('sessions', () => {
	afterEach(() => {
		setSystemTime()
	})

	describe('sessionCookie', () => {
		it('takes the __Host- prefix and Secure over HTTPS', () => {
			expect(sessionCookie('https://stockpot.example.ts.net')).toEqual({
				name: '__Host-stockpot_session',
				secure: true,
			})
		})

		it('keeps a plain name without Secure over HTTP', () => {
			expect(cookie).toEqual({ name: 'stockpot_session', secure: false })
		})
	})

	describe('with a session started', () => {
		let db: TestDb
		let signedIn: TestCookieJar

		beforeEach(async () => {
			;({ db } = await createTestDb())
			insertOwner(db, passwordHash)

			const first = createCookieJar()

			startSession({ db, cookies: first, cookie }, start)
			signedIn = nextRequestCookies(first)
		})

		it('sends the token in an HttpOnly, SameSite=Lax cookie for 30 days', () => {
			const first = createCookieJar()

			startSession({ db, cookies: first, cookie }, start)

			expect(first.sent.get(cookie.name)?.options).toEqual({
				path: '/',
				httpOnly: true,
				sameSite: 'lax',
				secure: false,
				maxAge: sessionLifetime / 1000,
			})
		})

		it('signs the owner in and leaves a young token alone', () => {
			const cookies = nextRequestCookies(signedIn)

			expect([resolveSession({ db, cookies, cookie }, later(1000)), cookies.sent.size]).toEqual([
				{ id: 1, via: 'session' },
				0,
			])
		})

		it('signs nobody in once the token has run out', () => {
			expect(resolveSession({ db, cookies: signedIn, cookie }, later(sessionLifetime))).toBeNull()
		})

		it('signs nobody in with a token it never issued', () => {
			const forged = createCookieJar({ [cookie.name]: 'x'.repeat(43) })

			expect(resolveSession({ db, cookies: forged, cookie }, start)).toBeNull()
		})

		describe('when the token is due for rotation', () => {
			let rotated: TestCookieJar
			let afterRotation: TestCookieJar

			beforeEach(() => {
				rotated = nextRequestCookies(signedIn)
				resolveSession({ db, cookies: rotated, cookie }, later(rotationAge))
				afterRotation = nextRequestCookies(rotated)
			})

			it('sends a new token', () => {
				expect(afterRotation.get(cookie.name)?.value).not.toBe(signedIn.get(cookie.name)?.value)
			})

			it('signs the owner in with the new token', () => {
				expect(resolveSession({ db, cookies: afterRotation, cookie }, later(rotationAge))).toEqual({
					id: 1,
					via: 'session',
				})
			})

			it('keeps the old token for the grace period without rotating it again', () => {
				const parallel = nextRequestCookies(signedIn)

				expect([
					resolveSession({ db, cookies: parallel, cookie }, later(rotationAge + 1000)),
					parallel.sent.size,
				]).toEqual([{ id: 1, via: 'session' }, 0])
			})

			it('ends the old token after the grace period', () => {
				const stale = nextRequestCookies(signedIn)

				expect(
					resolveSession({ db, cookies: stale, cookie }, later(rotationAge + rotationGrace)),
				).toBeNull()
			})

			/* The browser that rotated first may be the thief's: the owner's copy of the old token,
			 * arriving after the grace period, must sign out the new token too. */
			it('ends every session when the old token comes back after the grace period', () => {
				const copy = nextRequestCookies(signedIn)
				const returning = later(rotationAge + rotationGrace)

				resolveSession({ db, cookies: copy, cookie }, returning)

				expect(resolveSession({ db, cookies: afterRotation, cookie }, returning)).toBeNull()
			})

			it('keeps the old token row until its 30 days are over, to catch its reuse', () => {
				const copy = nextRequestCookies(signedIn)
				const lastDay = later(sessionLifetime - 1)

				resolveSession({ db, cookies: copy, cookie }, lastDay)

				expect(resolveSession({ db, cookies: afterRotation, cookie }, lastDay)).toBeNull()
			})
		})

		describe('when the token is used in its last minute', () => {
			let lastMinute: TestCookieJar

			beforeEach(() => {
				lastMinute = nextRequestCookies(signedIn)
				resolveSession({ db, cookies: lastMinute, cookie }, later(sessionLifetime - 30_000))
			})

			it('rotates it, so the session goes on with the new token', () => {
				const next = nextRequestCookies(lastMinute)

				expect(resolveSession({ db, cookies: next, cookie }, later(sessionLifetime))).toEqual({
					id: 1,
					via: 'session',
				})
			})
		})
	})

	describe('across a restart', () => {
		let directory: string
		let cookies: TestCookieJar

		beforeEach(async () => {
			setSystemTime(start)

			const created = await $`mktemp -d`.text()

			directory = created.trim()

			const before = await openDatabase({ path: join(directory, 'stockpot.db'), migrationsFolder })
			const first = createCookieJar()

			insertOwner(before.db, passwordHash)
			startSession({ db: before.db, cookies: first, cookie })
			before.sqlite.close()
			cookies = nextRequestCookies(first)
		})

		afterEach(async () => {
			await $`rm -rf ${directory}`
		})

		it('keeps the owner signed in', async () => {
			const after = await openDatabase({ path: join(directory, 'stockpot.db'), migrationsFolder })

			expect(resolveSession({ db: after.db, cookies, cookie })).toEqual({ id: 1, via: 'session' })
			after.sqlite.close()
		})
	})
})
