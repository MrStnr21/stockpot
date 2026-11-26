// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { countNotes } from '#/features/notes/server/counts'
import { instanceDb } from '#/server/db/instance'
import { route, type RouteContext } from '#/server/http'

/* The same access as the list: the owner's session or a device token. */

/** How many live notes share each category and status, for the list's filter counts. */
export const GET = route.authorized<RouteContext>(async () =>
	Response.json({ counts: countNotes(await instanceDb()) }),
)
