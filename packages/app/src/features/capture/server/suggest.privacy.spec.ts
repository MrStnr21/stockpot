// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test'
import { faker } from '@faker-js/faker'
import { categoryRowFactory } from '#tests/factories/categories'
import { noteRowFactory } from '#tests/factories/notes'
import { configuredSettingsFactory } from '#tests/factories/settings'
import { termRowFactory } from '#tests/factories/terms'
import { createTestDb } from '#tests/setup/db'
import type * as v from 'valibot'

import { parseOutput, type SuggestInput } from '#/server/engines/contract'
import { createRouter } from '#/server/engines/router'

import { createSuggester } from './suggest'

const { db } = await createTestDb()

const category = await categoryRowFactory.transient({ db }).create()

const settings = configuredSettingsFactory.build()

async function suggest<TSchema extends v.GenericSchema>(input: SuggestInput<TSchema>) {
	const output = parseOutput(input.output, {
		categories: [String(category.id)],
		senses: [],
		language: 'en',
	})

	return { output, engine: 'gemini', model: null, searchSuggestions: null, elapsedMs: 0 }
}

async function unexpected(): Promise<never> {
	throw new Error('Unexpected card request')
}

const engine = { id: 'gemini', suggest, explain: unexpected, research: unexpected }

describe('private category suggestions', () => {
	beforeEach(() => {
		spyOn(engine, 'suggest')
	})

	afterEach(() => {
		mock.restore()
	})

	it('sends only the term through the router to the engine', async () => {
		const router = createRouter({
			db,
			settings: () => settings,
			agentCommand: null,
			build: () => ({ gemini: engine, 'agent-command': null, 'openai-compatible': null }),
		})

		const { term } = termRowFactory.build()
		const { text, context } = noteRowFactory.build({ text: `${term.toUpperCase()}!` })
		const note = { text, context: context ?? null, url: faker.internet.url(), isPrivate: true }

		const answer = await createSuggester({ router }).suggest(db, {
			note,
			history: [],
			language: settings.cardLanguage,
		})

		expect(answer.source).toBe('engine')
		expect(engine.suggest).toHaveBeenCalledWith(
			expect.objectContaining({
				note: { term, text: null, context: null, url: null, isPrivate: true },
			}),
			expect.anything(),
		)
	})
})
