// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import * as v from 'valibot'

import {
	bulkChangeSchema,
	createNote,
	listNotes,
	newNoteSchema,
	notesQuerySchema,
} from '#/features/notes/server'
import { changeNotes } from '#/features/notes/server/bulk'
import { instanceDb } from '#/server/db/instance'
import { HttpError, readJson, route, type RouteContext } from '#/server/http'

/* Every notes route takes the owner's session or a device token: the Shortcut saves notes with a
 * token (CAP-5), and the native app will use the same API (D4). */

function describeIssue(issue: v.BaseIssue<unknown>) {
	return `${v.getDotPath(issue) ?? 'query'}: ${issue.message}`
}

/** One page of notes, newest first: `?status=`, `?categoryId=`, `?q=`, `?cursor=` and `?limit=`. */
export const GET = route.authorized<RouteContext>(async ({ request }) => {
	const { searchParams } = new URL(request.url)
	const query = v.safeParse(notesQuerySchema, Object.fromEntries(searchParams))

	if (!query.success) {
		throw new HttpError(400, {
			code: 'invalid_query',
			message: 'The query string does not match what this route accepts.',
			issues: query.issues.map(describeIssue),
		})
	}

	return Response.json(listNotes(await instanceDb(), query.output))
})

/** Saves a note and answers with it at once; research happens later, in a job. */
export const POST = route.authorized<RouteContext>(async ({ request }) => {
	const capture = await readJson(request, newNoteSchema)
	const { note, merged } = createNote(await instanceDb(), capture)

	return Response.json(note, { status: merged ? 200 : 201 })
})

/** Moves several notes to a category or archives them; the answer lists each note's outcome in request order. */
export const PATCH = route.authorized<RouteContext>(async ({ request }) => {
	const { ids, change } = await readJson(request, bulkChangeSchema)

	return Response.json({ results: changeNotes(await instanceDb(), ids, change) })
})
