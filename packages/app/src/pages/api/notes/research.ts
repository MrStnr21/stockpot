// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { researchNowSchema } from '#/features/research/server/now'
import { instanceResearchNow } from '#/instance'
import { readJson, route, type RouteContext } from '#/server/http'

/* The same access as `POST /api/notes/:id/research`: the owner's session or a device token. */

/** Researches several notes now; the answer lists each note's outcome in request order. */
export const POST = route.authorized<RouteContext>(async ({ request }) => {
	const { ids } = await readJson(request, researchNowSchema)

	return Response.json({ results: await instanceResearchNow(ids) })
})
