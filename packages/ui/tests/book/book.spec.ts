// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { Glob } from 'bun'
import { expect, test, type Page } from '@playwright/test'

const previews = [
	...new Glob('stories/**/index.html').scanSync({ cwd: `${import.meta.dirname}/../../dist` }),
]
	.toSorted()
	.map((file) => `/${file.replace(/index\.html$/u, '')}`)

const light = '[data-scheme="light"]'

const dark = '[data-scheme="dark"]'

function story(component: string, state: string) {
	return `/stories/components/${component}/${component}/${state}/`
}

async function openStory(page: Page, path: string) {
	const response = await page.goto(path)

	expect(response?.status()).toBe(200)
	await expect(page.locator('astro-island[client="load"]:not([ssr])')).toHaveCount(1)
}

async function expectCurrentRow(page: Page) {
	await openStory(page, story('list', 'current'))

	const panel = page.locator(light)

	await expect(panel.getByRole('link', { name: 'RAG' })).toHaveAttribute('aria-current', 'true')
	await expect(panel.getByRole('link', { name: 'Bun' })).not.toHaveAttribute('aria-current')
}

async function moveAcrossSegments(page: Page) {
	await openStory(page, story('segmented', 'states'))

	const tablist = page.locator(light).getByRole('tablist').first()
	const card = tablist.getByRole('tab', { name: 'Card' })
	const deeper = tablist.getByRole('tab', { name: 'How it works' })
	const handsOn = tablist.getByRole('tab', { name: 'Hands-on' })

	await card.focus()
	await page.keyboard.press('ArrowRight')
	await expect(deeper).toBeFocused()
	await expect(deeper).toHaveAttribute('aria-selected', 'true')
	await expect(card).toHaveAttribute('aria-selected', 'false')
	await expect(card).toHaveAttribute('tabindex', '-1')

	await page.keyboard.press('ArrowLeft')
	await page.keyboard.press('ArrowLeft')
	await expect(handsOn).toBeFocused()
	await expect(handsOn).toHaveAttribute('aria-selected', 'true')
}

test.describe('UI kit book', () => {
	test.afterEach(async ({ page }) => {
		const messages = await page.consoleMessages()

		const consoleErrors = messages
			.filter((message) => message.type() === 'error')
			.map((message) => message.text())

		expect(consoleErrors).toEqual([])
		expect(await page.pageErrors()).toEqual([])
	})

	test('builds story previews', () => {
		expect(previews.length).toBeGreaterThan(0)
	})

	for (const preview of previews) {
		test(`${preview} renders both schemes without horizontal overflow`, async ({ page }) => {
			await openStory(page, preview)

			await expect(page.locator(`${light} > :nth-child(2)`)).toBeVisible()
			await expect(page.locator(`${dark} > :nth-child(2)`)).toBeVisible()

			const { clientWidth, scrollWidth } = await page.evaluate(() => ({
				clientWidth: document.documentElement.clientWidth,
				scrollWidth: document.documentElement.scrollWidth,
			}))

			expect(scrollWidth).toBeLessThanOrEqual(clientWidth)
		})
	}

	test('toggles the switch by click and Space', async ({ page }) => {
		await openStory(page, story('switch', 'toggle-row'))

		const control = page.locator(light).getByRole('switch', { name: 'Private' })

		await expect(control).toHaveAttribute('aria-checked', 'false')
		await control.click()
		await expect(control).toHaveAttribute('aria-checked', 'true')
		await control.press('Space')
		await expect(control).toHaveAttribute('aria-checked', 'false')
	})

	test('opens a modal sheet and closes it with Escape and the close button', async ({ page }) => {
		await openStory(page, story('sheet', 'modal'))

		const panel = page.locator(light)
		const opener = panel.getByRole('button', { name: 'Open sheet' })
		const dialog = panel.locator('dialog')
		const modal = panel.locator('dialog:modal')

		await opener.click()
		await expect(modal).toHaveAccessibleName('New note')
		await expect(modal.getByRole('textbox', { name: 'Word, term or idea' })).toBeFocused()
		await page.keyboard.press('Escape')
		await expect(dialog).toHaveJSProperty('open', false)
		await expect(dialog).toBeHidden()

		await opener.click()
		await expect(modal).toBeVisible()
		await modal.getByRole('button', { name: 'Close', exact: true }).click()
		await expect(dialog).toHaveJSProperty('open', false)
		await expect(dialog).toBeHidden()
	})

	test('clears the search field and returns focus to it', async ({ page }) => {
		await openStory(page, story('search-field', 'states'))

		const row = page
			.locator(light)
			.getByRole('listitem')
			.filter({ hasText: 'Pressed · focused, typing' })

		const input = row.getByRole('searchbox', { name: 'Search notes and cards' })
		const clear = row.getByRole('button', { name: 'Clear search' })

		await expect(input).toHaveValue('kafka')
		await clear.click()
		await expect(input).toHaveValue('')
		await expect(input).toBeFocused()
		await expect(clear).toBeHidden()
	})

	test('applies an attachment to the list row link', async ({ page }) => {
		await openStory(page, story('list', 'attached'))

		const row = page.locator(light).getByRole('link', { name: 'Bun' })

		await expect(row).toHaveAttribute('data-attached', 'true')
	})

	test('marks the current list row', async ({ page }) => {
		await expectCurrentRow(page)
	})

	test('moves between segments with the arrow keys and selects the one it lands on', async ({
		page,
	}) => {
		await moveAcrossSegments(page)
	})

	test('ignores a click while the button is loading', async ({ page }) => {
		await openStory(page, story('button', 'loading'))

		const button = page.locator(light).getByRole('button', { name: 'Save' })
		const counter = page.locator(light).locator('[data-activations]')

		await expect(button).toHaveAttribute('aria-busy', 'true')
		// Playwright treats aria-disabled as disabled, so bypass its click guard.
		await button.click({ force: true })
		await expect(counter).toHaveAttribute('data-activations', '0')
	})

	test('removes the skeleton shimmer with reduced motion', async ({ page }) => {
		await openStory(page, story('skeleton', 'shapes'))

		const tile = page.locator(light).locator('[data-shape="tile"]')

		async function animationName() {
			return tile.evaluate((element) => getComputedStyle(element, '::after').animationName)
		}

		await expect.poll(animationName).toBe('shimmer')
		await page.emulateMedia({ reducedMotion: 'reduce' })
		await expect.poll(animationName).toBe('none')
	})
})
