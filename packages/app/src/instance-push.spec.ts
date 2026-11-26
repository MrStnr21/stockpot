// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { afterEach, beforeEach, describe, expect, it, mock, spyOn, type Mock } from 'bun:test'
import { storedBody } from '#tests/factories/card-bodies'
import { categoryRowFactory } from '#tests/factories/categories'
import { explanationRowFactory } from '#tests/factories/explanations'
import { noteRowFactory } from '#tests/factories/notes'
import { createTestDb, type TestDb } from '#tests/setup/db'
import { pushClient, pushRequest, stubGlobalFetch, type PushClient } from '#tests/setup/push'
import { eq } from 'drizzle-orm'
import * as v from 'valibot'

import type { PushFetch } from '#/features/push/server/send'
import { saveSubscription } from '#/features/push/server/subscriptions'
import { pushPayloadSchema } from '#/features/push/shared/payload'
import { readCardView } from '#/features/research/server/card-view'
import type { FormatId } from '#/lib/format-ids'
import { config } from '#/server/config'
import * as instance from '#/server/db/instance'
import { explanations } from '#/server/db/schema/explanations'
import { notes } from '#/server/db/schema/notes'
import { log } from '#/server/log'

import { readyNotifier } from './instance-push'

describe('readyNotifier', () => {
	let db: TestDb
	let browser: PushClient
	let pushes: Mock<PushFetch>

	beforeEach(async () => {
		;({ db } = await createTestDb())
		spyOn(instance, 'instanceDb').mockResolvedValue(db)
		spyOn(log, 'info').mockImplementation(() => {
			// Keep the key creation message out of the test log.
		})
		// The push service: no request leaves the test.
		pushes = stubGlobalFetch()
		browser = await pushClient()
		saveSubscription(db, browser.subscription, 'en')
	})

	afterEach(() => {
		mock.restore()
	})

	/** A note in a category of `format` with a saved first card, as a research-now job leaves it. */
	async function savedNote(format: FormatId, isPrivate = false) {
		const category = await categoryRowFactory.transient({ db }).create({ format })

		const note = await noteRowFactory
			.transient({ db })
			.create({ categoryId: category.id, isPrivate, status: 'ready' })

		db.insert(explanations)
			.values({
				...explanationRowFactory.build(),
				noteId: note.id,
				format,
				depth: 1,
				body: storedBody(format, 1),
				engine: 'gemini',
			})
			.run()

		return { note, category }
	}

	/** The notification the browser shows for the only push request sent. */
	async function shown() {
		expect(pushes).toHaveBeenCalledTimes(1)

		const { url, body } = pushRequest(pushes)

		expect(url).toBe(browser.subscription.endpoint)

		return v.parse(pushPayloadSchema, JSON.parse(await browser.decrypt(body))).notification
	}

	it('sends nothing for a note deleted since its card was saved', async () => {
		const { note } = await savedNote('report')

		db.update(notes).set({ deletedAt: new Date() }).where(eq(notes.id, note.id)).run()
		await readyNotifier(db)({ noteId: note.id, pagesRead: 12 })

		expect(pushes).not.toHaveBeenCalled()
	})

	it('sends nothing for a note that never existed', async () => {
		await readyNotifier(db)({ noteId: 999 })

		expect(pushes).not.toHaveBeenCalled()
	})

	it('sends a private idea as "a private note", with no category or pages', async () => {
		const { note, category } = await savedNote('report', true)

		await readyNotifier(db)({ noteId: note.id, pagesRead: 12 })

		const notification = await shown()
		const sent = JSON.stringify(notification)

		expect(notification).toMatchObject({
			title: 'Report ready: a private note',
			body: 'Tap to read',
		})
		expect([note.text, category.name, '12'].filter((value) => sent.includes(value))).toEqual([])
	})

	it("sends a public idea's report with the pages read and its reading time", async () => {
		const { note } = await savedNote('report')
		const minutes = readCardView(db, { get: () => null }, { noteId: note.id, now: new Date() })

		await readyNotifier(db)({ noteId: note.id, pagesRead: 12 })

		expect(minutes?.readingMinutes).toBeNumber()
		expect(await shown()).toMatchObject({
			title: `Report ready: ${note.text}`,
			body: `12 pages read · about ${Math.max(1, Math.round(minutes?.readingMinutes ?? 0))} min`,
			navigate: `${config.publicOrigin}/notes/${note.id}`,
			tag: `ready-${note.id}`,
		})
	})

	it('sends a brief card as Ready with its category', async () => {
		const { note, category } = await savedNote('brief')

		await readyNotifier(db)({ noteId: note.id })

		expect(await shown()).toMatchObject({
			title: `Ready: ${note.text}`,
			body: `${category.name} · tap to read`,
		})
	})

	it('writes the message in the language the browser subscribed in', async () => {
		const { note } = await savedNote('brief', true)

		saveSubscription(db, browser.subscription, 'ru')
		await readyNotifier(db)({ noteId: note.id })

		expect(await shown()).toMatchObject({ lang: 'ru' })
	})
})
