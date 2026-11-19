// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { faker } from '@faker-js/faker'

import { createMiddleware } from '#/middleware'
import { createAuth, type Auth } from '#/server/auth'
import { sessionCookie, startSession } from '#/server/auth/sessions'
import { owner } from '#/server/db/schema/auth'
import type { RouteContext } from '#/server/http'

import { createCookieJar, nextRequestCookies, type TestCookieJar } from './cookies'
import type { TestDb } from './db'

export interface SignedInInstance {
	readonly auth: Auth
	/** The cookies of a browser where the owner is signed in; pass `nextRequestCookies(session)`. */
	readonly session: TestCookieJar
}

/** An instance on `db` whose owner exists and is signed in in one browser. */
export function signedInInstance(db: TestDb, publicOrigin: string): SignedInInstance {
	const auth = createAuth({
		db,
		publicOrigin,
		announce() {
			// The owner exists from the start, so no setup code is ever printed.
		},
	})

	const browser = createCookieJar()

	db.insert(owner)
		.values({ id: 1, passwordHash: faker.string.alphanumeric(32) })
		.run()
	startSession({ db, cookies: browser, cookie: sessionCookie(publicOrigin) })

	return { auth, session: nextRequestCookies(browser) }
}

export interface RouteRequest {
	readonly request: Request
	/** The cookies the request carries; none by default. */
	readonly cookies?: TestCookieJar
	/** The route's parameters, such as `{ id: '7' }` for `[id].ts`. */
	readonly params?: Readonly<Record<string, string | undefined>>
}

export type RouteHandler = (
	context: RouteContext & { readonly params: RouteRequest['params'] & object },
) => Promise<Response>

/** Sends a request through the middleware, as the server does, and on to the route's handler. */
export async function sendThroughMiddleware(
	{ auth, publicOrigin }: { readonly auth: Auth; readonly publicOrigin: string },
	{ request, cookies = createCookieJar(), params = {} }: RouteRequest,
	handler: RouteHandler,
): Promise<Response> {
	const middleware = createMiddleware({ resolveOwner: auth.resolveOwner, publicOrigin })
	const context = { request, locals: {}, cookies, params, isPrerendered: false }

	return middleware(context, async () => handler(context))
}
