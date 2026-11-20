// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { createCategory, listCategories, newCategorySchema } from '#/features/categories/server'
import { instanceDb } from '#/server/db/instance'
import { readJson, route, type RouteContext } from '#/server/http'

export const GET = route.authorized<RouteContext>(async () => {
	const categories = listCategories(await instanceDb())

	return Response.json({ categories })
})

export const POST = route.session<RouteContext>(async ({ request }) => {
	const category = await readJson(request, newCategorySchema)

	return Response.json(createCategory(await instanceDb(), category), { status: 201 })
})
