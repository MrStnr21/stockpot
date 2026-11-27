// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { faker } from '@faker-js/faker'
import { expect, test, type Page } from '@playwright/test'

import { ownerServer } from './owner-server'
import { seedCards } from './seed-cards'

const { origin, startServer, createOwner } = ownerServer(9)

const password = faker.internet.password({ length: 16 })

/* The web app's own requests carry the session cookie and its origin. */
const webApp = { headers: { origin } }

/* The Cards board's notes that Base keeps, in the owner's category order. */
const keptFrames = [
	{ key: '01', text: 'serendipity', category: 'English' },
	{ key: '03', text: 'Ollama', category: 'AI' },
	{ key: '02', text: 'Bun', category: 'Technology' },
	{ key: '04', text: 'Idempotency', category: 'Concept' },
] as const

type Scheme = 'light' | 'dark'

/** Keeps a note through the card's own endpoint. */
async function keep(page: Page, id: number | undefined) {
	const response = await page.request.patch(`${origin}/api/notes/${id}`, {
		...webApp,
		data: { kept: true },
	})

	expect(response.status()).toBe(200)
}

/** Opens Base once its islands have hydrated: the list and the card pane. */
async function openBase(page: Page, search = '') {
	await page.goto(`${origin}/base${search}`)
	await expect(page.locator('astro-island[client="load"]:not([ssr])')).toHaveCount(2)
}

function base(page: Page) {
	return page.getByRole('region', { name: 'Base', exact: true })
}

function rowLink(page: Page, title: string) {
	return base(page).getByRole('link', { name: title })
}

function sectionHeadings(page: Page) {
	return base(page).getByRole('heading', { level: 2 })
}

function searchField(page: Page) {
	return page.getByRole('searchbox', { name: 'Search Base' })
}

async function attach(page: Page, name: string) {
	await test.info().attach(name, {
		body: await page.screenshot({ fullPage: true }),
		contentType: 'image/png',
	})
}

/** Frame 10: Base before the first Keep. */
async function matchEmpty(page: Page, scheme: Scheme) {
	await page.emulateMedia({ colorScheme: scheme })
	await openBase(page)
	await expect(page.getByRole('heading', { name: 'Nothing kept yet' })).toBeVisible()
	await expect(page.getByRole('link', { name: 'Open Today' })).toHaveAttribute('href', '/')
	await expect(searchField(page)).toBeDisabled()
	await attach(page, `390-${scheme}-10`)
}

/** Frames 08 (the groups) and 09 (a search). */
async function matchPhone(page: Page, scheme: Scheme) {
	await page.emulateMedia({ colorScheme: scheme })
	await openBase(page)
	await expect(sectionHeadings(page)).toHaveCount(4)
	await attach(page, `390-${scheme}-08`)
	await searchField(page).fill('run')
	await expect(page.getByText('2 results in Base')).toBeVisible()
	await attach(page, `390-${scheme}-09`)
}

test.describe('Base', () => {
	let ids: Map<string, number>
	let stopServer: (() => Promise<void>) | null = null

	async function keepAll(page: Page) {
		for (const { key } of keptFrames) {
			// oxlint-disable-next-line no-await-in-loop -- One keep after the other, as a person taps them.
			await keep(page, ids.get(key))
		}
	}

	/** Frame 04: Base beside an opened card, its row current. */
	async function matchWide(page: Page, scheme: Scheme) {
		await page.emulateMedia({ colorScheme: scheme })
		await openBase(page, `?note=${ids.get('02')}`)
		await expect(rowLink(page, 'Bun')).toHaveAttribute('aria-current', 'true')
		await attach(page, `${page.viewportSize()?.width}-${scheme}-04`)
	}

	test.beforeEach(async ({ page }) => {
		const server = await startServer(test.info().config.configFile ?? '')

		stopServer = server.stop
		await createOwner(page, server.code, password)
		ids = seedCards(server.dataDir)
	})

	test.afterEach(async () => {
		await stopServer?.()
	})

	test('shows an empty Base with the way to Today at 390 px', async ({ page }) => {
		await page.setViewportSize({ width: 390, height: 844 })
		await matchEmpty(page, 'light')
		await matchEmpty(page, 'dark')
	})

	test('groups kept cards by category and drops one un-kept on its card page at 390 px', async ({
		page,
	}) => {
		await page.setViewportSize({ width: 390, height: 844 })
		await keepAll(page)
		await openBase(page)

		await expect(sectionHeadings(page)).toHaveText(keptFrames.map(({ category }) => category))
		await expect(page.getByText('4 kept', { exact: true })).toBeVisible()

		await rowLink(page, 'Bun').click()
		await expect(page).toHaveURL(`${origin}/notes/${ids.get('02')}?from=base`)
		await expect(page.locator('astro-island[client="load"]:not([ssr])')).toHaveCount(1)
		await expect(
			page.getByRole('main').getByRole('link', { name: 'Base', exact: true }),
		).toHaveAttribute('href', '/base')

		const unkept = page.waitForResponse(
			(response) =>
				response.url() === `${origin}/api/notes/${ids.get('02')}` &&
				response.request().method() === 'PATCH',
		)

		await page.getByRole('button', { name: 'Kept' }).click()
		const unkeptResponse = await unkept

		expect(unkeptResponse.status()).toBe(200)
		await expect(page.getByRole('button', { name: 'Keep' })).toBeVisible()

		await page.goBack()

		await expect(rowLink(page, 'Bun')).toHaveCount(0)
		await expect(sectionHeadings(page)).toHaveText(['English', 'AI', 'Concept'])
		await expect(page.getByText('3 kept', { exact: true })).toBeVisible()
	})

	test('searches the kept cards and clears the search at 390 px', async ({ page }) => {
		await page.setViewportSize({ width: 390, height: 844 })
		await keepAll(page)
		await openBase(page)

		await searchField(page).fill('run')

		await expect(page.getByText('2 results in Base')).toBeVisible()
		await expect(base(page).getByRole('listitem')).toHaveCount(2)
		await expect(rowLink(page, 'Bun')).toBeVisible()
		await expect(rowLink(page, 'Ollama')).toBeVisible()
		await expect(base(page).locator('mark').first()).toHaveText(/^run/iu)

		await searchField(page).fill('kubernets')

		await expect(page.getByRole('heading', { name: 'Nothing matches “kubernets”' })).toBeVisible()

		await page
			.getByRole('button', { name: 'Clear search' })
			.filter({ hasText: 'Clear search' })
			.click()

		await expect(sectionHeadings(page)).toHaveText(keptFrames.map(({ category }) => category))
		await expect(searchField(page)).toHaveValue('')
	})

	test('opens a kept card beside Base and removes its row when un-kept at 1440 px', async ({
		page,
	}) => {
		await page.setViewportSize({ width: 1440, height: 900 })
		await keepAll(page)
		await openBase(page, `?note=${ids.get('01')}`)

		const pane = page.locator('main aside')

		await expect(pane.getByRole('heading', { level: 2 })).toHaveText('serendipity')
		await expect(rowLink(page, 'serendipity')).toHaveAttribute('aria-current', 'true')

		await pane.getByRole('button', { name: 'Kept' }).click()

		await expect(rowLink(page, 'serendipity')).toHaveCount(0)
		await expect(pane.getByRole('button', { name: 'Keep' })).toBeVisible()
		await expect(sectionHeadings(page)).toHaveText(['AI', 'Technology', 'Concept'])
	})

	test('matches the Base boards at 390 px in both schemes', async ({ page }) => {
		await page.setViewportSize({ width: 390, height: 844 })
		await keepAll(page)
		await matchPhone(page, 'light')
		await matchPhone(page, 'dark')
	})

	test('matches the Base board beside an opened card at 768 px in both schemes', async ({
		page,
	}) => {
		await page.setViewportSize({ width: 768, height: 1024 })
		await keepAll(page)
		await matchWide(page, 'light')
		await matchWide(page, 'dark')
	})

	test('matches the Base board beside an opened card at 1440 px in both schemes', async ({
		page,
	}) => {
		await page.setViewportSize({ width: 1440, height: 900 })
		await keepAll(page)
		await matchWide(page, 'light')
		await matchWide(page, 'dark')
	})
})
