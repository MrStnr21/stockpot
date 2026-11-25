// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import * as v from 'valibot'

import { noteIdSchema } from '#/features/notes/server'
import { instanceResearchNow } from '#/instance'
import { HttpError, route, type RouteContext } from '#/server/http'

/* Like every notes route, this takes the owner's session or a device token: the Shortcut offers
 * Research now. A note without a card gets at most one active job, whoever asks. */

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

/** Researches one note now: 202 when a job was queued, 200 when there is a job or a card already. */
export const POST = route.authorized<NoteContext>(async ({ params }) => {
	const [result] = await instanceResearchNow([noteId(params)])

	if (result.outcome === 'not_found') {
		throw new HttpError(404, { code: 'not_found', message: 'There is no such note.' })
	}

	return Response.json(result, { status: result.outcome === 'queued' ? 202 : 200 })
})
