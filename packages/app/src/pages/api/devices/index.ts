// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { instanceAuth, newDeviceSchema } from '#/server/auth'
import { readJson, route, type RouteContext } from '#/server/http'

/* Session only, like every device route: a stolen device token must not be able to mint more tokens
 * or see which devices hold one. */

/** The owner's devices, newest first, each with a masked hint of its token instead of the token. */
export const GET = route.session<RouteContext>(async () => {
	const auth = await instanceAuth()

	return Response.json({ devices: auth.devices.list() })
})

/** Creates a device. This answer is the only place its token ever appears. */
export const POST = route.session<RouteContext>(async ({ request }) => {
	const { name } = await readJson(request, newDeviceSchema)
	const auth = await instanceAuth()

	return Response.json(auth.devices.create(name), {
		status: 201,
		headers: { 'cache-control': 'no-store' },
	})
})
