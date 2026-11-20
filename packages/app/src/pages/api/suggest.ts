// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import * as v from 'valibot'

import { newNoteSchema } from '#/features/notes/schemas'
import { matchHistory } from '#/features/notes/server/history'
import { readSettings } from '#/features/settings/server'
import { instanceSuggester } from '#/instance'
import { instanceDb } from '#/server/db/instance'
import { readJson, route, type RouteContext } from '#/server/http'

const suggestSchema = v.pick(newNoteSchema, ['text', 'context', 'url', 'private'])

export const POST = route.authorized<RouteContext>(async ({ request }) => {
	const { text, context, url, private: isPrivate } = await readJson(request, suggestSchema)
	const db = await instanceDb()
	const history = matchHistory(db, text, isPrivate)
	const { cardLanguage } = readSettings(db)
	const suggester = await instanceSuggester()

	const suggestion = await suggester.suggest(db, {
		note: { text, context, url, isPrivate },
		history,
		language: cardLanguage,
	})

	return Response.json({ history, ...suggestion })
})
