// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import {
	readSettings,
	toPublicSettings,
	updateSettings,
	type Settings,
} from '#/features/settings/server'
import { settingsChangeSchema } from '#/features/settings/server/change'
import { instanceDb } from '#/server/db/instance'
import { readJson, route, type RouteContext } from '#/server/http'
import { currentRunner } from '#/server/jobs/runner'

/* Session only: a device token must not read the engine setup or change it. Every answer goes
 * through `toPublicSettings`, so no key ever leaves the server, and the request body is never logged. */

function answer(settings: Settings) {
	return Response.json(toPublicSettings(settings), { headers: { 'cache-control': 'no-store' } })
}

export const GET = route.session<RouteContext>(async () => answer(readSettings(await instanceDb())))

/** Applies a change and answers with the settings after it. */
export const PATCH = route.session<RouteContext>(async ({ request }) => {
	const change = await readJson(request, settingsChangeSchema)
	const settings = updateSettings(await instanceDb(), change)

	// The nightly batch is planned in the digest time zone, so either change moves it.
	if (change.digest?.batchTime !== undefined || change.digest?.timeZone !== undefined) {
		currentRunner()?.refreshSchedules()
	}

	return answer(settings)
})
