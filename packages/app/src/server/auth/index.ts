// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

/*
 * The owner account and web sessions (D5). This is the only module that reads the session cookie or
 * the sessions table: the middleware resolves the owner through it, and the setup, sign-in and
 * sign-out handlers call it.
 */
import { config } from '#/server/config'
import type { Db } from '#/server/db/client'
import { instanceDb } from '#/server/db/instance'
import { mayUseCookie, type CookieJar, type Owner, type ResolverContext } from '#/server/policy'

import {
	createSetupCode,
	hashPassword,
	hasOwner,
	insertOwner,
	normalizeSetupCode,
	verifyPassword,
} from './owner'
import { endAllSessions, replaceSession, resolveSession, sessionCookie } from './sessions'
import { secretsMatch } from './tokens'

export { passwordSchema } from './owner'

export interface AuthOptions {
	readonly db: Db
	readonly publicOrigin: string
	/** Where the setup code is printed: the server log, unless a spec listens. */
	readonly announce?: (message: string) => void
}

export interface SetupForm {
	readonly code: string
	readonly password: string
}

export type SetupResult = 'created' | 'wrong_code' | 'already_set_up'

export interface SignInResult {
	readonly status: 'signed_in' | 'wrong_password' | 'no_owner'
}

export interface Auth {
	/**
	 * Whether the instance still waits for its owner. While it does, a setup code exists and has been
	 * printed to the log.
	 */
	readonly needsSetup: () => boolean
	/** Creates the owner when the setup code is right, and signs them in. */
	readonly setUp: (cookies: CookieJar, form: SetupForm) => Promise<SetupResult>
	readonly signIn: (cookies: CookieJar, password: string) => Promise<SignInResult>
	readonly resolveOwner: (context: ResolverContext) => Promise<Owner | null>
}

/** The setup code of an instance without an owner, once one has been printed. */
interface PendingSetup {
	code?: string
}

function printToLog(message: string) {
	// oxlint-disable-next-line no-console -- The server has no logger yet (SRV-7); the owner reads the setup code on the console.
	console.log(message)
}

export function createAuth({ db, publicOrigin, announce = printToLog }: AuthOptions): Auth {
	const cookie = sessionCookie(publicOrigin)
	// Kept in memory only: a restart prints a new code, and creating the owner ends it.
	const setup: PendingSetup = {}

	function needsSetup() {
		if (hasOwner(db)) {
			delete setup.code

			return false
		}

		if (setup.code === undefined) {
			setup.code = createSetupCode()
			announce(
				`stockpot has no owner yet. To claim this instance, open ${publicOrigin}/setup and enter the setup code ${setup.code}. The code works until the owner is created or the server restarts.`,
			)
		}

		return true
	}

	return {
		needsSetup,

		async setUp(cookies, { code, password }) {
			if (!needsSetup() || setup.code === undefined) {
				return 'already_set_up'
			}

			if (!secretsMatch(normalizeSetupCode(code), normalizeSetupCode(setup.code))) {
				return 'wrong_code'
			}

			const passwordHash = await hashPassword(password)

			// Another request with the right code may have created the owner while this one hashed.
			const isCreated = db.transaction((tx) => {
				if (!insertOwner(tx, passwordHash)) {
					return false
				}

				// Sessions of an owner deleted by hand, to reset a forgotten password, end with it.
				endAllSessions(tx)
				replaceSession({ db: tx, cookies, cookie })

				return true
			})

			delete setup.code

			return isCreated ? 'created' : 'already_set_up'
		},

		async signIn(cookies, password) {
			if (!hasOwner(db)) {
				return { status: 'no_owner' }
			}

			if (!(await verifyPassword(db, password))) {
				return { status: 'wrong_password' }
			}

			db.transaction((tx) => {
				replaceSession({ db: tx, cookies, cookie })
			})

			return { status: 'signed_in' }
		},

		async resolveOwner({ request, cookies }) {
			return mayUseCookie(request) ? resolveSession({ db, cookies, cookie }) : null
		},
	}
}

/** The auth this process created, if it has. */
interface ProcessAuth {
	auth?: Promise<Auth>
}

const thisProcess: ProcessAuth = {}

/** The auth of this instance, on its database; the middleware, the pages and boot share it. */
export async function instanceAuth(): Promise<Auth> {
	thisProcess.auth ??= instanceDb().then((db) =>
		createAuth({ db, publicOrigin: config.publicOrigin }),
	)

	return thisProcess.auth
}
