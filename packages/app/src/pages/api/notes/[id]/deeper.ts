// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import * as v from 'valibot'

import { noteIdSchema } from '#/features/notes/server'
import { deeperSchema } from '#/features/research/server/deeper'
import { instanceDeeper } from '#/instance'
import { HttpError, readJson, route, type RouteContext } from '#/server/http'

/* Like every notes route, this takes the owner's session or a device token: the Shortcut may ask for a
 * deeper level. Each level of a note gets at most one `now` job and one batch job, whoever asks. */

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

/**
 * Asks for the next depth level of a note's card. The body is `{}` for tonight's batch or
 * `{ now: true }` for at once. 202 when a job was queued, 200 when there is one or the last level is
 * written already.
 */
export const POST = route.authorized<NoteContext>(async ({ params, request }) => {
	const id = noteId(params)
	const { now } = await readJson(request, deeperSchema)
	const result = await instanceDeeper(id, { now })

	if (result.outcome === 'not_found') {
		throw new HttpError(404, { code: 'not_found', message: 'There is no such note.' })
	}

	if (result.outcome === 'no_card') {
		throw new HttpError(409, {
			code: 'no_card',
			message: 'The note has no card to go deeper from yet.',
		})
	}

	return Response.json(result, { status: result.outcome === 'queued' ? 202 : 200 })
})
