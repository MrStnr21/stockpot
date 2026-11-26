// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { which } from 'bun'
import { faker } from '@faker-js/faker'
import { expect, test, type Page } from '@playwright/test'
import * as v from 'valibot'

import { ownerServer, routeToAgentCommand } from './owner-server'

const { origin, startServer, createOwner, signIn } = ownerServer(5)

const password = faker.internet.password({ length: 16 })

/* The fake agent suggests Technology for every note, so the sheet has a suggestion to pick. */
const agentCommand = `${which('bun') ?? 'bun'} '${import.meta.dirname}/fake-agent.ts'`

const listedNote = v.object({
	id: v.number(),
	text: v.string(),
	categoryId: v.nullable(v.number()),
})

const notesPage = v.object({ notes: v.array(listedNote) })

const listedCategory = v.object({ id: v.number(), name: v.string() })

const categoryList = v.object({ categories: v.array(listedCategory) })

/* The saved notes with this text, read through the list's API in the page's session. */
async function listedNotes(page: Page, text: string) {
	const response = await page.request.get(`${origin}/api/notes?limit=100`)
	const { notes } = v.parse(notesPage, await response.json())

	return notes.filter((note) => note.text === text)
}

async function technologyId(page: Page) {
	const response = await page.request.get(`${origin}/api/categories`)
	const { categories } = v.parse(categoryList, await response.json())

	return categories.find(({ name }) => name === 'Technology')?.id
}

/* The note's row in the notes list, which shows a saved note without a reload. */
function listedRow(page: Page, text: string) {
	return page.getByRole('main').getByRole('link', { name: text })
}

/* The sheet is an island hydrated when the browser is idle; until then N and Add do nothing new. */
async function waitForSheet(page: Page) {
	await expect(page.locator('astro-island[client="idle"]:not([ssr])')).toHaveCount(1)
}

/* The notes list and the card pane inside it, hydrated, so the list hears about a save; and the sheet over it. */
async function openNotes(page: Page) {
	await page.goto(`${origin}/notes`)
	await expect(page.locator('astro-island[client="load"]:not([ssr])')).toHaveCount(2)
	await waitForSheet(page)
}

test.describe('capture sheet', () => {
	let stopServer: (() => Promise<void>) | null = null

	test.beforeAll(async ({ browser }) => {
		const server = await startServer(test.info().config.configFile ?? '', {
			STOCKPOT_AGENT_COMMAND: agentCommand,
		})

		const page = await browser.newPage()

		stopServer = server.stop
		await createOwner(page, server.code, password)
		await page.close()
		routeToAgentCommand(server.dataDir)
	})

	test.afterAll(async () => {
		await stopServer?.()
	})

	test.beforeEach(async ({ page }) => {
		await signIn(page, password)
	})

	test.describe('at 1440 px', () => {
		test.use({ viewport: { width: 1440, height: 900 } })

		test.beforeEach(async ({ page }) => {
			await openNotes(page)
		})

		test('saves the suggested category with the keyboard', async ({ page }) => {
			const sheet = page.getByRole('dialog', { name: 'New note' })
			const term = sheet.getByRole('textbox', { name: 'Word, term or idea' })

			await page.keyboard.press('n')
			await expect(term).toBeFocused()
			await term.fill('Kafka')
			await expect(sheet.getByRole('button', { name: 'Technology' })).toHaveAttribute(
				'aria-pressed',
				'true',
			)
			await page.keyboard.press('ControlOrMeta+Enter')

			await expect(page.getByText('Saved: Kafka')).toBeVisible()
			await expect(sheet).toBeHidden()
			await expect(listedRow(page, 'Kafka')).toBeVisible()
			expect(await listedNotes(page, 'Kafka')).toMatchObject([
				{ categoryId: await technologyId(page) },
			])
		})

		test('saves once when the shortcut and the button come together', async ({ page }) => {
			const sheet = page.getByRole('dialog', { name: 'New note' })
			const requests: { method: string; url: string }[] = []

			page.on('request', (request) => {
				requests.push({ method: request.method(), url: request.url() })
			})
			await page.keyboard.press('n')
			await sheet.getByRole('textbox', { name: 'Word, term or idea' }).fill('Bun')
			await expect(sheet.getByRole('button', { name: 'Technology' })).toHaveAttribute(
				'aria-pressed',
				'true',
			)
			await sheet.evaluate((dialog) => {
				dialog.dispatchEvent(
					new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true }),
				)
				dialog.querySelector<HTMLButtonElement>('footer button:last-of-type')?.click()
			})

			await expect(page.getByText('Saved: Bun')).toBeVisible()
			expect(requests).toContainEqual({ method: 'POST', url: `${origin}/api/notes` })
			expect(
				requests.filter(({ method, url }) => method === 'POST' && url === `${origin}/api/notes`),
			).toHaveLength(1)
		})

		test('returns focus to the opener on Escape', async ({ page }) => {
			const opener = page.getByRole('complementary').getByRole('link', { name: /New note/u })
			const sheet = page.getByRole('dialog', { name: 'New note' })

			await opener.click()
			await expect(sheet.getByRole('textbox', { name: 'Word, term or idea' })).toBeFocused()
			await page.keyboard.press('Escape')

			await expect(sheet).toBeHidden()
			await expect(opener).toBeFocused()
		})
	})

	test.describe('at 390 px', () => {
		test.use({ viewport: { width: 390, height: 844 } })

		test('saves from the Add tab and undoes the save', async ({ page }) => {
			const sheet = page.getByRole('dialog', { name: 'New note' })

			await openNotes(page)
			await page.getByRole('navigation').getByRole('link', { name: 'Add' }).click()
			await sheet.getByRole('textbox', { name: 'Word, term or idea' }).fill('Idempotency')
			await expect(sheet.getByRole('button', { name: 'Technology' })).toHaveAttribute(
				'aria-pressed',
				'true',
			)
			await sheet.getByRole('button', { name: 'Save', exact: true }).click()

			await expect(page.getByText('Saved: Idempotency')).toBeVisible()
			await expect(listedRow(page, 'Idempotency')).toHaveCount(1)

			await page.getByRole('button', { name: 'Undo' }).click()

			await expect(page.getByText('Removed')).toBeVisible()
			await expect(listedRow(page, 'Idempotency')).toHaveCount(0)
		})
	})
})
