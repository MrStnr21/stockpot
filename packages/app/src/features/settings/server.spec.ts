// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { beforeEach, describe, expect, it } from 'bun:test'
import { agentCommand, configuredSettingsFactory } from '#tests/factories/settings'
import { createTestDb, type TestDb } from '#tests/setup/db'
import * as v from 'valibot'

import { settings as settingsTable } from '#/server/db/schema/settings'

import {
	defaultSettings,
	readSettings,
	readTimeZone,
	settingsPatchSchema,
	toPublicSettings,
	updateSettings,
	type Settings,
} from './server'

/** Every key in the settings, the values no client may ever receive. */
function secretsOf({ engines }: Settings) {
	return [engines.gemini.apiKey, engines['openai-compatible'].apiKey].filter(
		(secret) => secret !== null,
	)
}

function parseZone(timeZone: string) {
	return v.safeParse(settingsPatchSchema, { digest: { timeZone } })
}

describe('settings', () => {
	let db: TestDb

	beforeEach(async () => {
		;({ db } = await createTestDb())
	})

	describe('on a new instance', () => {
		it('reads the defaults', () => {
			expect(readSettings(db)).toEqual(defaultSettings())
		})

		it('defaults the time zone to the server', () => {
			expect(readTimeZone(db)).toBe(new Intl.DateTimeFormat().resolvedOptions().timeZone)
		})

		it('ships no engine configured', () => {
			expect(secretsOf(defaultSettings())).toEqual([])
		})
	})

	describe('updateSettings', () => {
		it('reads back what it stored', () => {
			const configured = configuredSettingsFactory.build()

			const returned = updateSettings(db, configured)

			expect(returned).toEqual(configured)
			expect(readSettings(db)).toEqual(configured)
		})

		it('keeps what a patch leaves out', () => {
			const configured = configuredSettingsFactory.build()

			updateSettings(db, configured)
			updateSettings(db, {
				digest: { limit: 3 },
				engines: { gemini: { models: { fast: 'faster' } } },
			})

			expect(readSettings(db)).toEqual({
				...configured,
				digest: { ...configured.digest, limit: 3 },
				engines: {
					...configured.engines,
					gemini: {
						...configured.engines.gemini,
						models: { ...configured.engines.gemini.models, fast: 'faster' },
					},
				},
			})
		})

		it('keeps both of two concurrent patches to one section', async () => {
			await Promise.all([
				Promise.resolve().then(() =>
					updateSettings(db, { engines: { gemini: { apiKey: 'gemini-key' } } }),
				),
				Promise.resolve().then(() =>
					updateSettings(db, {
						engines: { 'openai-compatible': { baseUrl: 'http://localhost:11434/v1' } },
					}),
				),
			])

			expect(readSettings(db).engines).toMatchObject({
				gemini: { apiKey: 'gemini-key' },
				'openai-compatible': { baseUrl: 'http://localhost:11434/v1' },
			})
		})

		it('clears a key set to null', () => {
			updateSettings(db, configuredSettingsFactory.build())
			updateSettings(db, { engines: { gemini: { apiKey: null } } })

			const { engines } = readSettings(db)

			expect(engines.gemini.apiKey).toBeNull()
		})

		it('feeds the time zone getter', () => {
			updateSettings(db, { digest: { timeZone: 'America/New_York' } })

			expect(readTimeZone(db)).toBe('America/New_York')
		})
	})

	describe('with a stored value that no longer validates', () => {
		beforeEach(async () => {
			await db.insert(settingsTable).values({ key: 'digest', value: { limit: 0 } })
		})

		it('refuses to read it', () => {
			expect(() => readSettings(db)).toThrow('Stored settings are invalid: digest.limit')
		})
	})

	describe('the time zone', () => {
		it.each(['Europe/Berlin', 'America/New_York', 'UTC', 'Europe/Kyiv', 'Asia/Kolkata'])(
			'accepts %s',
			(zone) => {
				expect(parseZone(zone).output).toEqual({ digest: { timeZone: zone } })
			},
		)

		it('takes the runtime spelling of a zone', () => {
			expect(parseZone('europe/berlin').output).toEqual({ digest: { timeZone: 'Europe/Berlin' } })
		})

		it.each(['Mars/Olympus', '+05:00', '-03:30', 'Europe/', 'local'])('rejects %s', (zone) => {
			const result = parseZone(zone)

			expect(result.issues?.map((issue) => [v.getDotPath(issue), issue.message])).toEqual([
				['digest.timeZone', 'Use an IANA time zone, such as Europe/Berlin'],
			])
		})

		describe('when a stored zone is invalid', () => {
			beforeEach(async () => {
				await db.insert(settingsTable).values({ key: 'digest', value: { timeZone: '+05:00' } })
			})

			it('is never returned', () => {
				expect(() => readTimeZone(db)).toThrow('Stored settings are invalid: digest.timeZone')
			})
		})
	})

	describe('settingsPatchSchema', () => {
		it.each([
			['a time past midnight', { digest: { time: '24:00' } }],
			['an empty digest', { digest: { limit: 0 } }],
			['an unknown time zone', { digest: { timeZone: 'Mars/Olympus' } }],
			['a language name', { cardLanguage: 'English' }],
			['an unknown engine', { routing: { fallbackOrder: ['gemini', 'llama'] } }],
			['an engine twice', { routing: { fallbackOrder: ['gemini', 'gemini'] } }],
			['an unknown tier', { routing: { categories: { '1': { engine: 'gemini', tier: 'max' } } } }],
			[
				'a base URL that is not http',
				{ engines: { 'openai-compatible': { baseUrl: 'file:///' } } },
			],
			['an empty key', { engines: { gemini: { apiKey: '  ' } } }],
		])('rejects %s', (_name, patch) => {
			expect(v.safeParse(settingsPatchSchema, patch).success).toBe(false)
		})
	})

	describe('toPublicSettings', () => {
		let configured: Settings
		let command: string

		beforeEach(() => {
			updateSettings(db, configuredSettingsFactory.build())
			configured = readSettings(db)
			command = agentCommand()
		})

		it('contains no key and not the agent command, at any depth', () => {
			const serialized = JSON.stringify(toPublicSettings(configured, command))
			const secrets = [...secretsOf(configured), command]

			expect(secrets).toHaveLength(3)

			for (const secret of secrets) {
				expect(serialized).not.toContain(secret)
			}
		})

		it('shows each key and the agent command as set', () => {
			expect(toPublicSettings(configured, command).engines).toMatchObject({
				'agent-command': { command: 'set' },
				gemini: { apiKey: 'set' },
				'openai-compatible': { apiKey: 'set' },
			})
		})

		it('shows a missing key and a missing agent command as not set', () => {
			expect(toPublicSettings(defaultSettings(), null).engines).toMatchObject({
				'agent-command': { command: 'not set' },
				gemini: { apiKey: 'not set' },
				'openai-compatible': { apiKey: 'not set' },
			})
		})

		it('keeps everything that is not a key', () => {
			const { engines, ...rest } = toPublicSettings(configured, command)

			expect(rest).toEqual({
				digest: configured.digest,
				cardLanguage: configured.cardLanguage,
				routing: configured.routing,
			})
			expect(engines['openai-compatible']).toMatchObject({
				baseUrl: configured.engines['openai-compatible'].baseUrl,
				models: configured.engines['openai-compatible'].models,
			})
		})
	})
})
