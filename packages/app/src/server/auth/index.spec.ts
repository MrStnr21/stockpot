// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import {
	afterEach,
	beforeEach,
	describe,
	expect,
	it,
	mock,
	setSystemTime,
	type Mock,
} from 'bun:test'
import { faker } from '@faker-js/faker'
import { createCookieJar, nextRequestCookies, type TestCookieJar } from '#tests/setup/cookies'
import { createTestDb, type TestDb } from '#tests/setup/db'

import { owner } from '#/server/db/schema/auth'

import { createAuth, type Auth } from '.'
import { longestWait } from './backoff'
import { rotationAge } from './sessions'

const publicOrigin = 'http://127.0.0.1:4321'

const cookieName = 'stockpot_session'

const browserCookieName = 'stockpot_browser'

/** A jar with only the browser cookie of `jar`: a known browser that is signed out. */
function browserOnly(jar: TestCookieJar) {
	return createCookieJar({ [browserCookieName]: jar.get(browserCookieName)?.value ?? '' })
}

const start = new Date('2026-11-19T12:00:00Z')

function formPost(cookies: TestCookieJar, headers: Record<string, string>) {
	return { request: new Request(`${publicOrigin}/signout`, { method: 'POST', headers }), cookies }
}

function pageRequest(cookies: TestCookieJar) {
	return { request: new Request(`${publicOrigin}/`), cookies }
}

/** The setup code from the last announcement. */
function announcedCode(announce: Mock<(message: string) => void>) {
	const message = announce.mock.calls.at(-1)?.[0] ?? ''

	return /setup code (?<code>[\dA-Z-]{19})/u.exec(message)?.groups?.code ?? ''
}

describe('createAuth', () => {
	let db: TestDb
	let announce: Mock<(message: string) => void>
	let auth: Auth
	let password: string

	beforeEach(async () => {
		;({ db } = await createTestDb())
		announce = mock()
		auth = createAuth({ db, publicOrigin, announce })
		password = faker.internet.password({ length: 16 })
	})

	afterEach(() => {
		setSystemTime()
	})

	describe('before the owner exists', () => {
		it('prints one setup code, with the address of the setup page', () => {
			auth.needsSetup()
			auth.needsSetup()

			const [message] = announce.mock.calls[0] ?? ['']

			expect([announce.mock.calls.length, message.includes(`open ${publicOrigin}/setup`)]).toEqual([
				1,
				true,
			])
		})

		it('refuses a wrong setup code and creates no owner', async () => {
			auth.needsSetup()

			const result = await auth.setUp(createCookieJar(), { code: 'AAAA-AAAA-AAAA-AAAA', password })

			expect([result, db.select().from(owner).all()]).toEqual(['wrong_code', []])
		})

		it('creates the owner with an argon2id hash and signs them in', async () => {
			auth.needsSetup()

			const cookies = createCookieJar()
			// Typed by hand: lower case, without the dashes.
			const code = announcedCode(announce).toLowerCase().replaceAll('-', '')
			const result = await auth.setUp(cookies, { code, password })
			const row = db.select().from(owner).get()
			const afterSetup = nextRequestCookies(cookies)

			expect([
				result,
				row?.passwordHash.startsWith('$argon2id$'),
				await auth.resolveOwner(pageRequest(afterSetup)),
			]).toEqual(['created', true, { id: 1 }])
		})
	})

	describe('once the owner exists', () => {
		let signedIn: TestCookieJar
		let code: string

		beforeEach(async () => {
			setSystemTime(start)
			auth.needsSetup()
			code = announcedCode(announce)

			const cookies = createCookieJar()

			await auth.setUp(cookies, { code, password })
			signedIn = nextRequestCookies(cookies)
		})

		it('runs setup once only, even with the right code', async () => {
			const again = await auth.setUp(createCookieJar(), { code, password: 'another password' })

			expect([again, auth.needsSetup(), announce.mock.calls.length]).toEqual([
				'already_set_up',
				false,
				1,
			])
		})

		it('signs in with the right password and replaces the session in the cookie', async () => {
			const cookies = nextRequestCookies(signedIn)
			const result = await auth.signIn(cookies, password)
			const afterSignIn = nextRequestCookies(cookies)

			expect([
				result,
				await auth.resolveOwner(pageRequest(signedIn)),
				await auth.resolveOwner(pageRequest(afterSignIn)),
			]).toEqual([{ status: 'signed_in' }, null, { id: 1 }])
		})

		it('refuses a wrong password', async () => {
			expect(await auth.signIn(createCookieJar(), 'wrong password')).toEqual({
				status: 'wrong_password',
			})
		})

		describe('after repeated wrong passwords', () => {
			beforeEach(async () => {
				for (let attempt = 0; attempt < 5; attempt += 1) {
					// oxlint-disable-next-line no-await-in-loop -- Each attempt must be counted before the next.
					await auth.signIn(createCookieJar(), 'wrong password')
					setSystemTime(new Date(Date.now() + longestWait))
				}

				// Each attempt waited its turn, so the last failure is now; its wait is 4 seconds.
				setSystemTime(new Date(Date.now() - longestWait))
			})

			it('makes the next attempt wait, without checking even the right password', async () => {
				expect(await auth.signIn(createCookieJar(), password)).toEqual({
					status: 'throttled',
					retryAfter: 4,
				})
			})

			it('lets the right password in once the wait is over', async () => {
				setSystemTime(new Date(Date.now() + 4000))

				expect(await auth.signIn(createCookieJar(), password)).toEqual({ status: 'signed_in' })
			})
		})

		describe('while strangers keep the shared count waiting', () => {
			let knownBrowser: TestCookieJar

			beforeEach(async () => {
				for (let attempt = 0; attempt < 8; attempt += 1) {
					// oxlint-disable-next-line no-await-in-loop -- Each attempt must be counted before the next.
					await auth.signIn(createCookieJar(), 'wrong password')
					setSystemTime(new Date(Date.now() + longestWait))
				}

				// The last failure is now, and the eighth makes strangers wait 32 seconds.
				setSystemTime(new Date(Date.now() - longestWait))
				knownBrowser = browserOnly(signedIn)
			})

			it('keeps a stranger waiting, even with the right password', async () => {
				expect(await auth.signIn(createCookieJar(), password)).toEqual({
					status: 'throttled',
					retryAfter: 32,
				})
			})

			it('signs the owner in from a browser they signed in from before', async () => {
				expect(await auth.signIn(knownBrowser, password)).toEqual({ status: 'signed_in' })
			})

			it('makes a known browser wait for its own wrong passwords only', async () => {
				for (let attempt = 0; attempt < 3; attempt += 1) {
					// oxlint-disable-next-line no-await-in-loop -- Each attempt must be counted before the next.
					await auth.signIn(knownBrowser, 'wrong password')
				}

				expect(await auth.signIn(knownBrowser, password)).toEqual({
					status: 'throttled',
					retryAfter: 1,
				})
			})
		})

		describe('with a stolen browser cookie alone', () => {
			it('signs nobody in', async () => {
				const stolen = browserOnly(signedIn)

				expect([
					await auth.resolveOwner(pageRequest(stolen)),
					await auth.signIn(stolen, 'wrong password'),
				]).toEqual([null, { status: 'wrong_password' }])
			})
		})

		describe('on sign-out', () => {
			let signedOut: TestCookieJar

			beforeEach(() => {
				signedOut = nextRequestCookies(signedIn)
				auth.signOut(formPost(signedOut, { origin: publicOrigin }))
			})

			it('ends the session and drops the cookie', async () => {
				expect([
					await auth.resolveOwner(pageRequest(signedIn)),
					signedOut.sent.get(cookieName)?.value,
				]).toEqual([null, ''])
			})
		})

		describe('on sign-out with a token due for rotation', () => {
			let rotatedToken: string

			beforeEach(async () => {
				setSystemTime(new Date(start.getTime() + rotationAge))

				const jar = nextRequestCookies(signedIn)
				const carried = signedIn.get(cookieName)?.value ?? ''
				const request = formPost(jar, { origin: publicOrigin, cookie: `${cookieName}=${carried}` })

				// The middleware resolves the owner first, which rotates the token.
				await auth.resolveOwner(request)
				rotatedToken = jar.get(cookieName)?.value ?? ''
				auth.signOut(request)
			})

			it('ends both the token the request carried and the one the rotation sent', async () => {
				const rotated = createCookieJar({ [cookieName]: rotatedToken })

				expect([
					rotatedToken === signedIn.get(cookieName)?.value,
					await auth.resolveOwner(pageRequest(signedIn)),
					await auth.resolveOwner(pageRequest(rotated)),
				]).toEqual([false, null, null])
			})
		})

		describe('on a sign-out post with neither Origin nor Sec-Fetch-Site', () => {
			beforeEach(() => {
				auth.signOut(formPost(nextRequestCookies(signedIn), {}))
			})

			it('leaves the session, as the cookie does not count', async () => {
				expect(await auth.resolveOwner(pageRequest(signedIn))).toEqual({ id: 1 })
			})
		})
	})
})
