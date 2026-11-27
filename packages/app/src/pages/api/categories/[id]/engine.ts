// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import * as v from 'valibot'

import { categoryIdSchema, findCategory } from '#/features/categories/server'
import { setCategoryRoute } from '#/features/settings/server/category-route'
import { instanceDb } from '#/server/db/instance'
import { defaultTier } from '#/server/engines/router'
import { engineIds } from '#/server/engines/settings'
import { HttpError, readJson, route, type RouteContext } from '#/server/http'

interface CategoryContext extends RouteContext {
	readonly params: Readonly<Record<string, string | undefined>>
}

/** `null` sends the category back to the default engine. */
const engineChoice = v.strictObject({ engine: v.nullable(v.picklist(engineIds)) })

/*
 * Session only, like every category write. An engine that is not set up is accepted: the router
 * skips it until it is. The route keeps the tier the category's format already writes at, so only
 * the engine changes.
 */
export const PUT = route.session<CategoryContext>(async ({ request, params }) => {
	const id = v.safeParse(categoryIdSchema, params.id)

	if (!id.success) {
		throw new HttpError(400, {
			code: 'invalid_id',
			message: 'A category id is a positive integer.',
		})
	}

	const { engine } = await readJson(request, engineChoice)
	const db = await instanceDb()
	const { format } = findCategory(db, id.output)
	const tier = defaultTier(format === 'report' ? 'research' : 'explain', format)

	setCategoryRoute(db, id.output, engine === null ? null : { engine, tier })

	return new Response(null, { status: 204 })
})
