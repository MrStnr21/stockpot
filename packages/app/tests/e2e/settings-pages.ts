// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { faker } from '@faker-js/faker'
import { expect, test, type Page } from '@playwright/test'
import * as v from 'valibot'

const listedCategory = v.object({ id: v.number(), name: v.string() })

const categoryList = v.object({ categories: v.array(listedCategory) })

const listedNote = v.object({
	id: v.number(),
	text: v.string(),
	categoryId: v.nullable(v.number()),
})

const notesPage = v.object({ notes: v.array(listedNote) })

/** Waits for the page's islands, so a control does something when pressed. */
export async function hydrated(page: Page): Promise<void> {
	await expect(page.locator('astro-island[ssr]')).toHaveCount(0)
}

/** Attaches a full-page screenshot to the report, to compare with the boards. */
export async function attach(page: Page, name: string): Promise<void> {
	await test.info().attach(name, {
		body: await page.screenshot({ fullPage: true }),
		contentType: 'image/png',
	})
}

// oxlint-disable-next-line typescript/explicit-module-boundary-types -- The helpers' types read best inferred.
export function settingsPages(origin: string) {
	/** The categories by name, through the API in the page's session. */
	async function categoryIds(page: Page) {
		const response = await page.request.get(`${origin}/api/categories`)
		const { categories } = v.parse(categoryList, await response.json())

		return new Map(categories.map(({ id, name }) => [name, id]))
	}

	async function open(page: Page, path: string) {
		await page.goto(`${origin}${path}`)
		await hydrated(page)
	}

	/** Waits for the settings change the page sends. */
	async function settingsSaved(page: Page) {
		return page.waitForResponse(
			(response) =>
				response.url() === `${origin}/api/settings` && response.request().method() === 'PATCH',
		)
	}

	/** A request with a device token alone, as a device sends it: no cookie, no origin. */
	async function statusWith(token: string, path: string, method: 'GET' | 'POST' = 'GET') {
		const response = await fetch(`${origin}${path}`, {
			method,
			headers: { authorization: `Bearer ${token}` },
		})

		return response.status
	}

	/** Saves a note in the category through the API, and gives back its text. */
	async function addNote(page: Page, categoryId: number | undefined) {
		const text = faker.lorem.words(3)

		const response = await page.request.post(`${origin}/api/notes`, {
			headers: { origin },
			data: { text, categoryId },
		})

		expect(response.ok()).toBe(true)

		return text
	}

	/** The category of the note with this text. */
	async function categoryOf(page: Page, text: string) {
		const response = await page.request.get(`${origin}/api/notes?limit=100`)
		const { notes } = v.parse(notesPage, await response.json())

		return notes.find((note) => note.text === text)?.categoryId
	}

	return { categoryIds, open, settingsSaved, statusWith, addNote, categoryOf }
}
