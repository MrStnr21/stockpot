// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { instanceAuth } from '#/server/auth'
import { config } from '#/server/config'
import { jsonError, type RouteContext } from '#/server/http'
import { log } from '#/server/log'
import {
	isCrossSite,
	type CookieJar,
	type OwnerResolver,
	type ResolverContext,
} from '#/server/policy'

export interface MiddlewareOptions {
	readonly resolveOwner: OwnerResolver
	readonly publicOrigin: string
}

type Next = () => Promise<Response>

type Middleware = (
	context: RouteContext & { readonly isPrerendered: boolean; readonly cookies: CookieJar },
	next: Next,
) => Promise<Response>

const internalError = { code: 'internal', message: 'Something went wrong on the server.' }

const notFound = { code: 'not_found', message: 'There is no such API route.' }

function isApi(request: Request) {
	return new URL(request.url).pathname.startsWith('/api/')
}

/**
 * API clients read JSON, so on `/api/*` Astro's HTML 404 page for an unknown path and its HTML 500
 * page become JSON errors that echo nothing of the failure; Astro has logged the error already.
 * A JSON answer from a route, such as its own 404, passes unchanged.
 */
function toApiResponse(response: Response) {
	if (response.headers.get('content-type')?.startsWith('application/json') === true) {
		return response
	}

	if (response.status === 404) {
		return jsonError(404, notFound)
	}

	return response.status >= 500 ? jsonError(500, internalError) : response
}

/**
 * Runs before every request: refuses one sent from another site, then puts the owner on
 * `Astro.locals`, where pages and `route.authorized` read it. On `/api/*` every error is JSON.
 */
export function createMiddleware({ resolveOwner, publicOrigin }: MiddlewareOptions): Middleware {
	return async (context, next) => {
		// Prerendering has no request to judge, and nobody is signed in.
		if (context.isPrerendered) {
			context.locals.owner = null

			return next()
		}

		if (isCrossSite(context.request, publicOrigin)) {
			return jsonError(403, {
				code: 'cross_site',
				message: 'Requests from another site are refused.',
			})
		}

		const api = isApi(context.request)

		try {
			context.locals.owner = (await resolveOwner(context)) ?? null

			const response = await next()

			return api ? toApiResponse(response) : response
		} catch (error) {
			if (!api) {
				throw error
			}

			// The path without its query, which could carry something private.
			const { pathname } = new URL(context.request.url)

			log.error('A request failed', {
				method: context.request.method,
				path: pathname,
				error: error instanceof Error ? error : String(error),
			})

			return jsonError(500, internalError)
		}
	}
}

async function resolveInstanceOwner(context: ResolverContext) {
	const auth = await instanceAuth()

	return auth.resolveOwner(context)
}

export const onRequest = createMiddleware({
	resolveOwner: resolveInstanceOwner,
	publicOrigin: config.publicOrigin,
})
