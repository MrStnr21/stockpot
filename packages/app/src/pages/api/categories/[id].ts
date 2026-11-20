// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import * as v from 'valibot'

import {
	categoryChangeSchema,
	categoryIdSchema,
	changeCategory,
	deleteCategory,
} from '#/features/categories/server'
import { removeCategoryRouting } from '#/features/settings/server'
import { instanceDb } from '#/server/db/instance'
import { HttpError, readJson, route, type RouteContext } from '#/server/http'

interface CategoryContext extends RouteContext {
	readonly params: Readonly<Record<string, string | undefined>>
}

function categoryId(params: CategoryContext['params']) {
	const id = v.safeParse(categoryIdSchema, params.id)

	if (!id.success) {
		throw new HttpError(400, {
			code: 'invalid_id',
			message: 'A category id is a positive integer.',
		})
	}

	return id.output
}

export const PATCH = route.session<CategoryContext>(async ({ request, params }) => {
	const id = categoryId(params)
	const change = await readJson(request, categoryChangeSchema)

	return Response.json(changeCategory(await instanceDb(), id, change))
})

const moveTarget = v.pipe(v.array(categoryIdSchema), v.maxLength(1))

export const DELETE = route.session<CategoryContext>(async ({ request, params }) => {
	const id = categoryId(params)
	const target = v.safeParse(moveTarget, new URL(request.url).searchParams.getAll('moveTo'))

	if (!target.success) {
		throw new HttpError(400, { code: 'invalid_query', message: 'Use one category id for moveTo.' })
	}

	const db = await instanceDb()
	db.transaction(
		(tx) => {
			deleteCategory(tx, id, target.output[0])
			removeCategoryRouting(tx, id)
		},
		{ behavior: 'immediate' },
	)

	return new Response(null, { status: 204 })
})
