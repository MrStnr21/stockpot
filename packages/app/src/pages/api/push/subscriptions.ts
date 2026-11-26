// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import {
	removalSchema,
	removeSubscription,
	saveSubscription,
	subscriptionSchema,
} from '#/features/push/server/subscriptions'
import { pickLocale } from '#/lib/i18n'
import { instanceDb } from '#/server/db/instance'
import { readJson, route, type RouteContext } from '#/server/http'

/* Session only: a notification carries the terms of the owner's notes, so a device token must not be
 * able to add an endpoint that would receive them. */

// A subscription is under 1 KiB; the rest is room for a long endpoint.
const maxBodyBytes = 4096

/** Subscribes this browser, or renews its subscription, in the language it asks for. */
export const POST = route.session<RouteContext>(async ({ request }) => {
	const subscription = await readJson(request, subscriptionSchema, maxBodyBytes)

	saveSubscription(
		await instanceDb(),
		subscription,
		pickLocale(request.headers.get('accept-language')),
	)

	return Response.json({ ok: true }, { status: 201 })
})

/** Unsubscribes the browser with this endpoint; 204 whether or not it was subscribed. */
export const DELETE = route.session<RouteContext>(async ({ request }) => {
	const { endpoint } = await readJson(request, removalSchema, maxBodyBytes)

	removeSubscription(await instanceDb(), endpoint)

	return new Response(null, { status: 204 })
})
