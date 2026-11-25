// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { faker } from '@faker-js/faker'
import { expect, test, type Page } from '@playwright/test'

import { ownerServer } from './owner-server'

const { origin, startServer, createOwner, signIn } = ownerServer(3)

const sourceUrl = 'https://example.com/stockpot-fork'

const password = faker.internet.password({ length: 16 })

const pages = [
	{ path: '/', current: 'Today' },
	{ path: '/notes', current: 'Notes' },
	{ path: '/base', current: 'Base' },
	{ path: '/settings', current: 'Settings' },
] as const

/* Add opens the capture sheet over its page, so its navigation is checked once the sheet is closed. */
const add = { path: '/add', current: 'Add' } as const

const routes = [...pages, add] as const

const widths = [
	{ width: 390, height: 844, items: ['Today', 'Notes', 'Add', 'Base', 'Settings'] },
	{ width: 768, height: 1024, items: ['Add', 'Today', 'Notes', 'Base', 'Settings'] },
	{ width: 1440, height: 900, items: ['Today', 'Notes', 'Base', 'Settings'] },
] as const

/* The sidebar has no Add item (its button is "New note"), so on Add nothing there is current. */
function marked(items: readonly string[], current: string) {
	return items.includes(current) ? [current] : []
}

async function expectNavigation(page: Page, items: readonly string[], current: string) {
	const navigation = page.getByRole('navigation')

	await expect(navigation).toHaveCount(1)
	await expect(navigation.getByRole('link')).toHaveText(items)
	await expect(navigation.locator('[aria-current="page"]')).toHaveText(marked(items, current))
	await expect(page.getByRole('heading', { level: 1 })).toHaveText(current)
}

test.describe('app shell', () => {
	let stopServer: (() => Promise<void>) | null = null

	test.beforeAll(async ({ browser }) => {
		const server = await startServer(test.info().config.configFile ?? '', {
			STOCKPOT_SOURCE_URL: sourceUrl,
		})

		const page = await browser.newPage()

		stopServer = server.stop
		await createOwner(page, server.code, password)
		await page.close()
	})

	test.afterAll(async () => {
		await stopServer?.()
	})

	test.describe('signed in', () => {
		test.beforeEach(async ({ page }) => {
			await signIn(page, password)
		})

		for (const { width, height, items } of widths) {
			for (const { path, current } of pages) {
				test(`shows one navigation on ${path} at ${width} px`, async ({ page }) => {
					await page.setViewportSize({ width, height })
					await page.goto(`${origin}${path}`)

					await expectNavigation(page, items, current)
				})
			}

			test(`opens the capture sheet on ${add.path} and shows one navigation at ${width} px`, async ({
				page,
			}) => {
				await page.setViewportSize({ width, height })
				await page.goto(`${origin}${add.path}`)

				const sheet = page.getByRole('dialog', { name: 'New note' })

				await expect(sheet).toBeVisible()
				await page.keyboard.press('Escape')
				await expect(sheet).toBeHidden()
				await expectNavigation(page, items, add.current)
			})
		}

		test('lists the source code link in the sidebar from 1440 px', async ({ page }) => {
			await page.setViewportSize({ width: 1440, height: 900 })
			await page.goto(`${origin}/settings`)

			const link = page.getByRole('link', { name: 'Source code' })

			await expect(link).toHaveCount(1)
			await expect(link).toHaveAttribute('href', sourceUrl)
			await expect(link).toBeVisible()
		})

		test('lists the source code link at the bottom of Settings below 1280 px', async ({ page }) => {
			await page.setViewportSize({ width: 390, height: 844 })
			await page.goto(`${origin}/settings`)

			const link = page.getByRole('link', { name: 'Source code' })

			await expect(link).toHaveAttribute('href', sourceUrl)
			await expect(link).toBeVisible()

			const box = await link.boundingBox()

			expect(box?.height).toBeGreaterThanOrEqual(44)
		})

		test('shows the offline banner only while the connection is marked offline', async ({
			page,
		}) => {
			await page.goto(`${origin}/`)

			const banner = page.getByRole('status')

			await expect(banner).toBeHidden()
			await page.evaluate(() => {
				document.documentElement.dataset.connection = 'offline'
			})
			await expect(banner).toBeVisible()
			await expect(banner).toContainText('Server out of reach.')
			await expect(banner).toContainText('Reading works; the actions wait until it is back.')
		})
	})

	test.describe('with a Russian browser', () => {
		test.use({ locale: 'ru-RU', viewport: { width: 390, height: 844 } })

		test.beforeEach(async ({ page }) => {
			await signIn(page, password)
		})

		test('speaks Russian', async ({ page }) => {
			await page.goto(`${origin}/`)

			await expect(page.locator('html')).toHaveAttribute('lang', 'ru')
			await expect(page.getByRole('navigation').getByRole('link')).toHaveText([
				'Сегодня',
				'Заметки',
				'Добавить',
				'База',
				'Настройки',
			])
		})
	})

	test.describe('signed out', () => {
		for (const { path } of routes) {
			test(`sends ${path} to sign-in`, async ({ page }) => {
				await page.goto(`${origin}${path}`)

				await expect(page).toHaveURL(`${origin}/signin`)
			})
		}
	})
})
