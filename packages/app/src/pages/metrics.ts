// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { config } from '#/server/config'
import { instanceDb } from '#/server/db/instance'
import { route } from '#/server/http'
import { metricsResponse } from '#/server/metrics'

/* Public to the session check, because a scraper has no session: STOCKPOT_METRICS_TOKEN guards it,
 * and without that variable the route answers 404. */
export const GET = route.public(async ({ request }) =>
	metricsResponse(request, { token: config.metricsToken, db: instanceDb }),
)
