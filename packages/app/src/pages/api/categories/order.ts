// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { categoryOrderSchema, reorderCategories } from '#/features/categories/server'
import { instanceDb } from '#/server/db/instance'
import { readJson, route, type RouteContext } from '#/server/http'

export const PUT = route.session<RouteContext>(async ({ request }) => {
	const { ids } = await readJson(request, categoryOrderSchema)

	reorderCategories(await instanceDb(), ids)

	return new Response(null, { status: 204 })
})
