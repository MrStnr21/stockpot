// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import * as v from 'valibot'

import { instanceAuth } from '#/server/auth'
import { HttpError, route, type RouteContext } from '#/server/http'

interface DeviceContext extends RouteContext {
	readonly params: Readonly<Record<string, string | undefined>>
}

// A row id as SQLite assigns it, without signs, leading zeros or anything a number would forgive.
const deviceIdSchema = v.pipe(
	v.string(),
	v.regex(/^[1-9]\d{0,14}$/u),
	v.transform(Number),
	v.safeInteger(),
)

/** Revokes a device: its row goes, and its token signs nobody in from the next request on. */
export const DELETE = route.session<DeviceContext>(async ({ params }) => {
	const id = v.safeParse(deviceIdSchema, params.id)

	if (!id.success) {
		throw new HttpError(400, { code: 'invalid_id', message: 'A device id is a positive integer.' })
	}

	const auth = await instanceAuth()

	if (!auth.devices.revoke(id.output)) {
		throw new HttpError(404, { code: 'not_found', message: 'There is no such device.' })
	}

	return new Response(null, { status: 204 })
})
