// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import * as v from 'valibot'

import { changeNote, deleteNote, noteChangeSchema, noteIdSchema } from '#/features/notes/server'
import { instanceDb } from '#/server/db/instance'
import { HttpError, readJson, route, type RouteContext } from '#/server/http'

interface NoteContext extends RouteContext {
	readonly params: Readonly<Record<string, string | undefined>>
}

function noteId(params: NoteContext['params']) {
	const id = v.safeParse(noteIdSchema, params.id)

	if (!id.success) {
		throw new HttpError(400, { code: 'invalid_id', message: 'A note id is a positive integer.' })
	}

	return id.output
}

/** Changes a note's category or status, or restores it with `deleted: false`. */
export const PATCH = route.authorized<NoteContext>(async ({ request, params }) => {
	const id = noteId(params)
	const change = await readJson(request, noteChangeSchema)

	return Response.json(changeNote(await instanceDb(), id, change))
})

/** Soft-deletes a note; `PATCH` with `deleted: false` brings it back. */
export const DELETE = route.authorized<NoteContext>(async ({ params }) => {
	deleteNote(await instanceDb(), noteId(params))

	return new Response(null, { status: 204 })
})
