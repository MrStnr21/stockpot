// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { afterEach, beforeEach, describe, expect, it, mock, spyOn, type Mock } from 'bun:test'
import { faker } from '@faker-js/faker'
import { categoryRowFactory } from '#tests/factories/categories'
import { explanationRowFactory } from '#tests/factories/explanations'
import { newNoteFactory, noteRowFactory } from '#tests/factories/notes'
import { configuredSettingsFactory } from '#tests/factories/settings'
import { termRowFactory } from '#tests/factories/terms'
import { sendThroughMiddleware, signedInInstance, type SignedInInstance } from '#tests/setup/auth'
import { createTestDb, type TestDb } from '#tests/setup/db'
import * as v from 'valibot'

import { createSuggester } from '#/features/capture/server/suggest'
import { updateSettings } from '#/features/settings/server'
import * as services from '#/instance'
import * as instance from '#/server/db/instance'
import { noteStatuses } from '#/server/db/schema/notes'
import { parseOutput, type SuggestInput } from '#/server/engines/contract'

import { POST } from './suggest'

const publicOrigin = 'http://127.0.0.1:4321'

const id = v.pipe(v.number(), v.integer(), v.minValue(1))

const timestamp = v.pipe(v.string(), v.isoTimestamp())

const historyNote = v.strictObject({
	id,
	text: v.string(),
	status: v.picklist(noteStatuses),
	private: v.boolean(),
	createdAt: timestamp,
})

const cardSource = v.strictObject({ title: v.string(), url: v.string() })

const historyCard = v.strictObject({
	id,
	noteId: v.nullable(id),
	format: v.string(),
	body: v.unknown(),
	sources: v.array(cardSource),
	isUncertain: v.boolean(),
	isDraft: v.boolean(),
	createdAt: timestamp,
})

const historyMatch = v.strictObject({
	termId: id,
	term: v.string(),
	meaning: v.string(),
	categoryId: v.nullable(id),
	state: v.picklist(['saved', 'seen', 'known']),
	note: v.nullable(historyNote),
	lastCard: v.nullable(historyCard),
})

const sense = v.strictObject({ sense: v.string(), categoryId: id })

const language = v.pipe(v.string(), v.regex(/^[a-z]{2}$/u))

const answer = v.strictObject({
	history: v.array(historyMatch),
	categories: v.pipe(v.array(id), v.maxLength(3)),
	senses: v.pipe(v.array(sense), v.maxLength(4)),
	language: v.nullable(language),
	source: v.picklist(['history', 'engine', 'none']),
	pending: v.boolean(),
})

describe('POST /api/suggest', () => {
	let db: TestDb
	let signedIn: SignedInInstance
	let categoryId: number
	const { cardLanguage } = configuredSettingsFactory.build()

	const router = {
		async suggest<TSchema extends v.GenericSchema>(input: SuggestInput<TSchema>) {
			const output = parseOutput(input.output, {
				categories: [String(categoryId)],
				senses: [],
				language: 'en',
			})

			return { output, engine: 'fake', model: null, searchSuggestions: null, elapsedMs: 0 }
		},
	}

	let calls: Mock<typeof router.suggest>

	beforeEach(async () => {
		;({ db } = await createTestDb())
		const category = await categoryRowFactory.transient({ db }).create()
		categoryId = category.id
		updateSettings(db, { cardLanguage })
		signedIn = signedInInstance(db, publicOrigin)
		spyOn(instance, 'instanceDb').mockResolvedValue(db)
		calls = spyOn(router, 'suggest')
		spyOn(services, 'instanceSuggester').mockResolvedValue(createSuggester({ router }))
	})

	afterEach(() => {
		mock.restore()
	})

	async function post(
		body: ReturnType<typeof newNoteFactory.build>,
		access: 'session' | 'device' | 'anonymous',
	) {
		const headers = new Headers({ origin: publicOrigin, 'content-type': 'application/json' })

		if (access === 'device') {
			const { token } = signedIn.auth.devices.create(faker.commerce.productName())
			headers.set('authorization', `Bearer ${token}`)
		}

		const request = new Request(`${publicOrigin}/api/suggest`, {
			method: 'POST',
			headers,
			body: JSON.stringify(body),
		})

		const cookies = access === 'session' ? signedIn.session : undefined

		return sendThroughMiddleware({ auth: signedIn.auth, publicOrigin }, { request, cookies }, POST)
	}

	it('requires authentication', async () => {
		const response = await post(newNoteFactory.build(), 'anonymous')
		expect(response.status).toBe(401)
		expect(calls).not.toHaveBeenCalled()
	})

	it('answers a device token and uses the configured card language', async () => {
		const capture = newNoteFactory.build({ private: true })
		const response = await post(capture, 'device')
		expect([response.status, v.parse(answer, await response.json())]).toEqual([
			200,
			{
				history: [],
				categories: [categoryId],
				senses: [],
				language: 'en',
				source: 'engine',
				pending: false,
			},
		])
		expect(calls.mock.calls[0]?.[0]).toMatchObject({
			language: cardLanguage,
			note: { context: capture.context, url: capture.url, isPrivate: true },
		})
	})

	it.each([
		['empty text', { text: '' }, 'text: Write the note.'],
		['oversized text', { text: faker.string.alpha(1001) }, 'text: Use at most 1000 characters.'],
		['a bad URL', { url: faker.string.alpha(10) }, 'url: Use an http or https URL.'],
	])('answers 400 for %s', async (_case, fields, issue) => {
		const response = await post(newNoteFactory.build(fields), 'session')
		expect([response.status, await response.json()]).toEqual([
			400,
			{
				error: {
					code: 'invalid_body',
					message: 'The body does not match what this route accepts.',
					issues: [issue],
				},
			},
		])
		expect(calls).not.toHaveBeenCalled()
	})

	it('returns the saved note of matching privacy and its card without calling the engine', async () => {
		const term = await termRowFactory.transient({ db }).create({ categoryId })

		const notes = noteRowFactory
			.transient({ db })
			.params({ termId: term.id, text: term.term, categoryId })

		const note = await notes.create({ isPrivate: true })
		await notes.create({ isPrivate: false })
		const card = await explanationRowFactory.transient({ db }).create({ noteId: note.id })

		const response = await post(newNoteFactory.build({ text: term.term, private: true }), 'session')
		expect([response.status, v.parse(answer, await response.json())]).toEqual([
			200,
			{
				history: [
					{
						termId: term.id,
						term: term.term,
						meaning: term.meaning,
						categoryId,
						state: 'saved',
						note: {
							id: note.id,
							text: note.text,
							status: note.status,
							private: true,
							createdAt: note.createdAt.toISOString(),
						},
						lastCard: {
							id: card.id,
							noteId: note.id,
							format: card.format,
							body: card.body,
							sources: card.sources,
							isUncertain: card.isUncertain,
							isDraft: card.isDraft,
							createdAt: card.createdAt.toISOString(),
						},
					},
				],
				categories: [categoryId],
				senses: [],
				language: null,
				source: 'history',
				pending: false,
			},
		])
		expect(calls).not.toHaveBeenCalled()
	})
})
