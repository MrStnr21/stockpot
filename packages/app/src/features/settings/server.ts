// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

/*
 * Runtime settings the owner changes in the app, one JSON value per section in the `settings` table.
 * A stored section is read as a patch over the defaults, so a missing row, or a field added after the
 * row was written, reads as its default. The engine sections are defined in src/server/engines/.
 *
 * Engine keys never leave the server: everything sent to a client goes through `toPublicSettings`,
 * which shows each one, and the agent command from the environment, only as "set" or "not set".
 * Keys are stored as plain text.
 * The nightly batch uses them unattended, so an encryption key would have to live on the same machine
 * as the database, and whoever can read the data directory could read both; the directory's
 * permissions and the owner's backups protect them instead (decided 2026-11-19).
 */
import { sql } from 'drizzle-orm'
import * as v from 'valibot'

import { config } from '#/server/config'
import type { Db } from '#/server/db/client'
import { settings as settingsTable } from '#/server/db/schema/settings'
import {
	applyEnginesPatch,
	defaultEngines,
	defaultRouting,
	enginesPatchSchema,
	enginesSchema,
	routingPatchSchema,
	routingSchema,
	toPublicEngines,
	type PublicEngines,
} from '#/server/engines/settings'

function isTimeZone(value: string) {
	try {
		return new Intl.DateTimeFormat('en-US', { timeZone: value }).resolvedOptions().timeZone !== ''
	} catch {
		return false
	}
}

const clockTime = v.pipe(
	v.string(),
	v.regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/u, 'Use a 24-hour time, such as 08:30'),
)

const digestLimit = v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(50))

const timeZone = v.pipe(
	v.string(),
	v.check(isTimeZone, 'Use an IANA time zone, such as Europe/Berlin'),
)

const languageCode = v.pipe(
	v.string(),
	v.regex(/^[a-z]{2}$/u, 'Use a two-letter ISO 639-1 code, such as en'),
)

const digestSchema = v.object({
	/** When the morning digest arrives, as HH:MM in `timeZone`. */
	time: clockTime,
	/** How many cards one digest holds at most. */
	limit: digestLimit,
	/** The IANA time zone the daily schedules fire in. */
	timeZone,
})

const settingsSchema = v.object({
	digest: digestSchema,
	cardLanguage: languageCode,
	engines: enginesSchema,
	routing: routingSchema,
})

export type Settings = v.InferOutput<typeof settingsSchema>

/**
 * A change to settings, and the shape a stored section is read in. A field left out keeps its value;
 * `null` clears a key or a model. `routing.categories` and `routing.fallbackOrder` are replaced whole.
 */
export const settingsPatchSchema = v.partial(
	v.object({
		digest: v.partial(digestSchema),
		cardLanguage: languageCode,
		engines: enginesPatchSchema,
		routing: routingPatchSchema,
	}),
)

export type SettingsPatch = v.InferOutput<typeof settingsPatchSchema>

type SectionKey = keyof Settings

const sectionKeys: readonly SectionKey[] = ['digest', 'cardLanguage', 'engines', 'routing']

/** The settings of a new instance. The time zone defaults to the server's own. */
export function defaultSettings(): Settings {
	return {
		digest: {
			time: '08:30',
			limit: 5,
			timeZone: new Intl.DateTimeFormat().resolvedOptions().timeZone,
		},
		cardLanguage: 'en',
		engines: defaultEngines(),
		routing: defaultRouting(),
	}
}

function applyPatch(settings: Settings, patch: SettingsPatch): Settings {
	return {
		digest: { ...settings.digest, ...patch.digest },
		cardLanguage: patch.cardLanguage ?? settings.cardLanguage,
		engines: applyEnginesPatch(settings.engines, patch.engines ?? {}),
		routing: { ...settings.routing, ...patch.routing },
	}
}

function describeIssue(issue: v.BaseIssue<unknown>) {
	return `${v.getDotPath(issue) ?? 'settings'}: ${issue.message}`
}

/** Reads every section, falling back to the defaults; a stored value that no longer validates throws. */
export async function readSettings(db: Db): Promise<Settings> {
	const rows = await db.select().from(settingsTable)
	const stored = Object.fromEntries(rows.map((row) => [row.key, row.value]))
	const result = v.safeParse(settingsPatchSchema, stored)

	if (!result.success) {
		throw new Error(`Stored settings are invalid: ${result.issues.map(describeIssue).join('; ')}`)
	}

	return applyPatch(defaultSettings(), result.output)
}

/** Applies a validated patch and stores the sections it touches, in one statement. */
export async function updateSettings(db: Db, patch: SettingsPatch): Promise<Settings> {
	const next = applyPatch(await readSettings(db), patch)

	const rows = sectionKeys.flatMap((key) =>
		patch[key] === undefined ? [] : [{ key, value: next[key] }],
	)

	if (rows.length > 0) {
		await db
			.insert(settingsTable)
			.values(rows)
			.onConflictDoUpdate({
				target: settingsTable.key,
				set: { value: sql`excluded.value`, updatedAt: new Date() },
			})
	}

	return next
}

/**
 * The time zone daily schedules fire in. `server/` cannot import a feature, so whatever starts the
 * job runner (SRV-6) hands it `() => readTimeZone(db)`.
 */
export async function readTimeZone(db: Db): Promise<string> {
	const { digest } = await readSettings(db)

	return digest.timeZone
}

/** Settings as they may leave the server: every key and the agent command reduced to its state. */
export interface PublicSettings {
	digest: Settings['digest']
	cardLanguage: string
	engines: PublicEngines
	routing: Settings['routing']
}

/** The one serializer for settings sent to a client. */
export function toPublicSettings(
	{ digest, cardLanguage, engines, routing }: Settings,
	agentCommand = config.agentCommand,
): PublicSettings {
	return { digest, cardLanguage, engines: toPublicEngines(engines, agentCommand), routing }
}
