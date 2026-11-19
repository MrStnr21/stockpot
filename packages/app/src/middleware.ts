// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { config } from '#/server/config'
import { jsonError, type RouteContext } from '#/server/http'
import { isCrossSite, resolveNobody, type OwnerResolver } from '#/server/policy'

export interface MiddlewareOptions {
	readonly resolveOwner: OwnerResolver
	readonly publicOrigin: string
}

type Next = () => Promise<Response>

type Middleware = (
	context: RouteContext & { readonly isPrerendered: boolean },
	next: Next,
) => Promise<Response>

/**
 * Runs before every request: refuses one sent from another site, then puts the owner on
 * `Astro.locals`, where pages and `route.authorized` read it.
 */
export function createMiddleware({ resolveOwner, publicOrigin }: MiddlewareOptions): Middleware {
	return async (context, next) => {
		// Prerendering has no request to judge.
		if (context.isPrerendered) {
			return next()
		}

		if (isCrossSite(context.request, publicOrigin)) {
			return jsonError(403, {
				code: 'cross_site',
				message: 'Requests from another site are refused.',
			})
		}

		context.locals.owner = await resolveOwner(context.request)

		return next()
	}
}

// SRV-4 replaces `resolveNobody` with the session resolver in src/server/auth/.
export const onRequest = createMiddleware({
	resolveOwner: resolveNobody,
	publicOrigin: config.publicOrigin,
})
