// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { readSettings } from '#/features/settings/server'
import { config } from '#/server/config'
import { instanceDb } from '#/server/db/instance'
import { configuredEngines } from '#/server/engines/settings'
import { healthResponse } from '#/server/health'
import { route } from '#/server/http'
import { currentRunner } from '#/server/jobs/runner'

/** Public, for uptime monitors and container health checks: it answers with status words only. */
export const GET = route.public(async () =>
	healthResponse({
		db: instanceDb,
		runner: () => currentRunner()?.health(),
		configuredEngines: (db) => configuredEngines(readSettings(db).engines, config.agentCommand),
	}),
)
