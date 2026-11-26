// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import * as v from 'valibot'

import { noteIdSchema } from '#/features/notes/server'
import { readCardView } from '#/features/research/server/card-view'
import { instanceProgressBoard } from '#/instance'
import { instanceDb } from '#/server/db/instance'
import { HttpError, route, type RouteContext } from '#/server/http'

/* Like every notes route, this takes the owner's session or a device token: a device that may list
 * notes may read their cards. */

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

/** A note's opened card: every level, its jobs and an idea's progress. */
export const GET = route.authorized<NoteContext>(async ({ params }) => {
	const id = noteId(params)

	const view = readCardView(await instanceDb(), instanceProgressBoard, {
		noteId: id,
		now: new Date(),
	})

	if (view === null) {
		throw new HttpError(404, { code: 'not_found', message: 'There is no such note.' })
	}

	return Response.json(view)
})
