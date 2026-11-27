// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { readSettings, toPublicSettings, type Settings } from '#/features/settings/server'
import type { PublicSettings } from '#/features/settings/shared/types'
import { config } from '#/server/config'
import type { Db } from '#/server/db/client'
import { needsAttention, readEngineOverview, type EngineOverview } from '#/server/engines/status'

/** What every settings page reads: the settings without their keys, and how each engine is doing. */
export interface SettingsOverview {
	readonly settings: PublicSettings
	readonly engines: readonly EngineOverview[]
	/** Whether an engine needs the owner: the dot on the Engines row and in the nav. */
	readonly attention: boolean
}

/**
 * Reads the settings once, for the page: the keys stay in `stored`, inside this function, and only
 * `toPublicSettings` leaves it. Six indexed lookups on `engine_runs` come with it.
 */
export function readSettingsOverview(db: Db, now: Date): SettingsOverview {
	const stored: Settings = readSettings(db)

	const engines = readEngineOverview(db, {
		engines: stored.engines,
		agentCommand: config.agentCommand,
		timeZone: stored.digest.timeZone,
		now,
	})

	return {
		settings: toPublicSettings(stored, config.agentCommand),
		engines,
		attention: needsAttention(engines),
	}
}
