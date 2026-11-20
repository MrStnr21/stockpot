// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { afterEach, beforeEach, describe, expect, it, mock, setSystemTime, spyOn } from 'bun:test'
import { noteRowFactory } from '#tests/factories/notes'
import { createTestDb } from '#tests/setup/db'

import { createRouter } from '#/server/engines/router'
import { defaultEngines, defaultRouting } from '#/server/engines/settings'
import { log } from '#/server/log'

import { createSuggester } from './suggest'

const { db } = await createTestDb()

const router = createRouter({
	db,
	settings: () => ({ engines: defaultEngines(), routing: defaultRouting() }),
	agentCommand: null,
})

const unconfigured = 'No engine is configured for suggest'

function request() {
	const { text, context } = noteRowFactory.build()

	return {
		note: { text, context: context ?? null, url: null, isPrivate: false },
		history: [],
		language: 'en',
	}
}

describe('category suggestion warnings', () => {
	beforeEach(() => {
		setSystemTime(new Date('2026-11-20T12:00:00Z'))
		spyOn(log, 'warn').mockImplementation(() => {
			// Keep the expected warnings out of the test log.
		})
	})

	afterEach(() => {
		setSystemTime()
		mock.restore()
	})

	it('logs a missing engine once across captures and again ten minutes after the first warning', async () => {
		const service = createSuggester({ router })
		await service.suggest(db, request())
		expect(log.warn).toHaveBeenCalledWith(unconfigured)

		setSystemTime(new Date('2026-11-20T12:09:59Z'))
		await service.suggest(db, request())
		expect(log.warn).toHaveBeenCalledTimes(1)

		setSystemTime(new Date('2026-11-20T12:10:00Z'))
		await service.suggest(db, request())
		expect(log.warn).toHaveBeenCalledTimes(2)
		expect(log.warn).toHaveBeenLastCalledWith(unconfigured)
	})

	it('logs a different warning line within the same interval', async () => {
		let message = unconfigured

		const service = createSuggester({
			router: {
				async suggest() {
					throw new Error(message)
				},
			},
		})

		await service.suggest(db, request())
		message = 'Connection closed'
		await service.suggest(db, request())
		expect(log.warn).toHaveBeenCalledTimes(2)
		expect(log.warn).toHaveBeenLastCalledWith(message)
	})
})
