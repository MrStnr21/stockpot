// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

/*
 * The shapes the settings API answers with, shared by the server, the settings pages and the client.
 * Engine keys appear only as their state: `PublicSettings` has no field that could hold one.
 */
import type { PublicEngines, Routing } from '#/server/engines/settings'

export type { EngineTestResult } from '#/server/engines/probe'

export type { EngineOverview } from '#/server/engines/status'

export interface PublicDigest {
	/** When the morning digest arrives, as HH:MM in `timeZone`. */
	readonly time: string
	/** When the nightly batch starts, as HH:MM in `timeZone`. */
	readonly batchTime: string
	/** How many cards one digest holds at most, 1 to 50. */
	readonly limit: number
	/** The canonical IANA name of the zone the daily schedules fire in. */
	readonly timeZone: string
}

/** Settings as they may leave the server: every key and the agent command reduced to its state. */
export interface PublicSettings {
	readonly digest: PublicDigest
	/** The card language, as an ISO 639-1 code. */
	readonly cardLanguage: string
	readonly engines: PublicEngines
	readonly routing: Routing
}

/** A device as `GET /api/devices` lists it, with ISO timestamps: never its token. */
export interface DeviceRow {
	readonly id: number
	readonly name: string
	/** The token's prefix and last characters, such as `sp1_…x7Qa`. */
	readonly hint: string
	readonly createdAt: string
	readonly lastUsedAt: string | null
}

/** A category as `GET /api/categories` lists it, with the count of its notes. */
export interface CategoryRow {
	readonly id: number
	readonly name: string
	readonly icon: string
	readonly color: string
	readonly format: string
	readonly instructions: string
	readonly position: number
	readonly noteCount: number
}
