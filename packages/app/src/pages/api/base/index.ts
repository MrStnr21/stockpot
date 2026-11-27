// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { readBase } from '#/features/notes/server/base'
import { instanceDb } from '#/server/db/instance'
import { route, type RouteContext } from '#/server/http'

/* The same access as the notes list: the owner's session or a device token, so the native app can
 * read Base too (D4). */

/** The kept notes by category: each group's count and its most recently kept notes. */
export const GET = route.authorized<RouteContext>(async () =>
	Response.json(readBase(await instanceDb())),
)
