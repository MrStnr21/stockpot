// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test'
import { faker } from '@faker-js/faker'
import { newNoteFactory, noteRowFactory } from '#tests/factories/notes'
import {
	sendThroughMiddleware,
	signedInInstance,
	type RouteHandler,
	type SignedInInstance,
} from '#tests/setup/auth'
import { createTestDb, type TestDb } from '#tests/setup/db'
import * as v from 'valibot'

import * as instance from '#/server/db/instance'

import { GET, POST } from './index'

const publicOrigin = 'http://127.0.0.1:4321'

const url = `${publicOrigin}/api/notes`

// A note in an answer has exactly these fields.
const answeredNote = v.strictObject({
	id: v.pipe(v.number(), v.integer()),
	text: v.string(),
	context: v.nullable(v.string()),
	url: v.nullable(v.string()),
	source: v.picklist(['web', 'shortcut']),
	categoryId: v.nullable(v.number()),
	status: v.string(),
	private: v.boolean(),
	createdAt: v.pipe(v.string(), v.isoTimestamp()),
	updatedAt: v.pipe(v.string(), v.isoTimestamp()),
})

/** The init of a POST that sends this note. */
function postBody(note: ReturnType<typeof newNoteFactory.build>) {
	return { method: 'POST', body: JSON.stringify(note) }
}

const notesPage = v.strictObject({
	notes: v.array(answeredNote),
	nextCursor: v.nullable(v.string()),
})

describe('/api/notes', () => {
	let db: TestDb
	let signedIn: SignedInInstance

	beforeEach(async () => {
		;({ db } = await createTestDb())
		signedIn = signedInInstance(db, publicOrigin)
		spyOn(instance, 'instanceDb').mockResolvedValue(db)
	})

	afterEach(() => {
		mock.restore()
	})

	async function send(handler: RouteHandler, request: Request, withSession: boolean) {
		const cookies = withSession ? signedIn.session : undefined

		return sendThroughMiddleware(
			{ auth: signedIn.auth, publicOrigin },
			{ request, cookies },
			handler,
		)
	}

	/** A request from the web app, where the owner is signed in. */
	async function fromWebApp(handler: RouteHandler, init: RequestInit = {}, path = url) {
		const headers = { origin: publicOrigin, 'content-type': 'application/json' }

		return send(handler, new Request(path, { headers, ...init }), true)
	}

	/** A request from the Shortcut, signed in with a device token. */
	async function fromShortcut(handler: RouteHandler, init: RequestInit = {}, path = url) {
		const { token } = signedIn.auth.devices.create('iPhone Shortcut')
		const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' }

		return send(handler, new Request(path, { headers, ...init }), false)
	}

	describe('POST', () => {
		it('answers 201 with the saved note, trimmed, with status new', async () => {
			const text = faker.word.noun()
			const response = await fromWebApp(POST, postBody(newNoteFactory.build({ text: ` ${text} ` })))
			const note = v.parse(answeredNote, await response.json())

			expect([response.status, note]).toMatchObject([
				201,
				{ text, status: 'new', source: 'web', private: false },
			])
		})

		it('saves a note sent with a device token', async () => {
			const response = await fromShortcut(
				POST,
				postBody(newNoteFactory.build({ source: 'shortcut' })),
			)

			expect([response.status, v.parse(answeredNote, await response.json()).source]).toEqual([
				201,
				'shortcut',
			])
		})

		it('answers 401 when nobody is signed in', async () => {
			const request = new Request(url, {
				headers: { origin: publicOrigin, 'content-type': 'application/json' },
				...postBody(newNoteFactory.build()),
			})

			const response = await send(POST, request, false)

			expect(response.status).toBe(401)
		})

		it.each([
			['an empty note', { text: '' }, 'text: Write the note.'],
			[
				'a URL that is not http or https',
				{ url: 'ftp://example.com/notes.txt' },
				'url: Use an http or https URL.',
			],
			[
				'a category that does not exist',
				{ categoryId: 404 },
				'categoryId: There is no such category.',
			],
		])('answers 400 for %s, naming the field', async (_case, fields, issue) => {
			const response = await fromWebApp(POST, postBody(newNoteFactory.build(fields)))

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
		})

		it('answers 400 for a body that is not JSON', async () => {
			const response = await fromWebApp(POST, { method: 'POST', body: '{"text":' })

			expect([response.status, await response.json()]).toEqual([
				400,
				{ error: { code: 'invalid_json', message: 'The body is not valid JSON.' } },
			])
		})
	})

	describe('GET', () => {
		let ids: number[]

		beforeEach(async () => {
			const notes = await noteRowFactory.transient({ db }).createList(3)

			ids = notes.map(({ id }) => id).toReversed()
		})

		it('answers the newest notes first, with a cursor to the next page', async () => {
			const firstResponse = await fromWebApp(GET, {}, `${url}?limit=2`)
			const first = v.parse(notesPage, await firstResponse.json())
			const nextPath = `${url}?limit=2&cursor=${first.nextCursor}`
			const secondResponse = await fromWebApp(GET, {}, nextPath)
			const second = v.parse(notesPage, await secondResponse.json())

			expect([...first.notes, ...second.notes].map(({ id }) => id)).toEqual(ids)
		})

		it('answers a device token too', async () => {
			const response = await fromShortcut(GET)

			expect([response.status, v.parse(notesPage, await response.json()).notes.length]).toEqual([
				200, 3,
			])
		})

		it('answers 401 when nobody is signed in', async () => {
			const response = await send(GET, new Request(url), false)

			expect(response.status).toBe(401)
		})

		it.each([
			['a limit over 100', 'limit=101', 'limit: Use a number from 1 to 100.'],
			['a limit of 0', 'limit=0', 'limit: Use a number from 1 to 100.'],
			[
				'a cursor it did not make',
				'cursor=bm90LWEtY3Vyc29y',
				'cursor: Use the nextCursor of the previous page.',
			],
			['a category id that is not one', 'categoryId=-1', 'categoryId: Use a positive integer.'],
		])('answers 400 for %s', async (_case, search, issue) => {
			const response = await fromWebApp(GET, {}, `${url}?${search}`)

			expect([response.status, await response.json()]).toEqual([
				400,
				{
					error: {
						code: 'invalid_query',
						message: 'The query string does not match what this route accepts.',
						issues: [issue],
					},
				},
			])
		})

		it('answers 400 for an unknown status', async () => {
			const response = await fromWebApp(GET, {}, `${url}?status=done`)

			expect(response.status).toBe(400)
		})
	})
})
