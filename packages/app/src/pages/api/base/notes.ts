// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import * as v from 'valibot'

import { baseNotesQuerySchema } from '#/features/notes/schemas'
import { listKept } from '#/features/notes/server/base'
import { instanceDb } from '#/server/db/instance'
import { HttpError, route, type RouteContext } from '#/server/http'

/* The same access as the notes list: the owner's session or a device token. */

function describeIssue(issue: v.BaseIssue<unknown>) {
	return `${v.getDotPath(issue) ?? 'query'}: ${issue.message}`
}

/**
 * One page of kept notes, most recently kept first: one category's with `?categoryId=` (`none` for
 * the uncategorized ones) or the matches of `?q=`, with `?cursor=` and `?limit=`.
 */
export const GET = route.authorized<RouteContext>(async ({ request }) => {
	const { searchParams } = new URL(request.url)
	const query = v.safeParse(baseNotesQuerySchema, Object.fromEntries(searchParams))

	if (!query.success) {
		throw new HttpError(400, {
			code: 'invalid_query',
			message: 'The query string does not match what this route accepts.',
			issues: query.issues.map(describeIssue),
		})
	}

	return Response.json(listKept(await instanceDb(), query.output))
})
