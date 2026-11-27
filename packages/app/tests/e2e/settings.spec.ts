// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { which } from 'bun'
import { faker } from '@faker-js/faker'
import { expect, test } from '@playwright/test'

import { ownerServer } from './owner-server'
import { attach, hydrated, settingsPages } from './settings-pages'

const { origin, startServer, createOwner, signIn } = ownerServer(10)

const password = faker.internet.password({ length: 16 })

/* The fake agent answers the engine test's fixed suggestion; it never calls a provider. */
const agentCommand = `${which('bun') ?? 'bun'} '${import.meta.dirname}/fake-agent.ts'`

const { categoryIds, open, settingsSaved, statusWith, addNote, categoryOf } = settingsPages(origin)

test.describe('settings', () => {
	let stopServer: (() => Promise<void>) | null = null

	test.beforeAll(async ({ browser }) => {
		const server = await startServer(test.info().config.configFile ?? '', {
			STOCKPOT_AGENT_COMMAND: agentCommand,
		})

		const page = await browser.newPage()

		stopServer = server.stop
		await createOwner(page, server.code, password)
		await page.close()
	})

	test.afterAll(async () => {
		await stopServer?.()
	})

	test.beforeEach(async ({ page }) => {
		await signIn(page, password)
	})

	test('keeps the digest settings changed on the phone', async ({ page }) => {
		await page.setViewportSize({ width: 390, height: 844 })
		await open(page, '/settings')

		const main = page.getByRole('main')

		await expect(main.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible()

		for (const head of ['Digest', 'Cards', 'Engines and devices', 'App', 'Account', 'About']) {
			// oxlint-disable-next-line no-await-in-loop -- Each group of the one page in turn.
			await expect(main.getByRole('heading', { level: 2, name: head })).toBeVisible()
		}

		const limit = main.locator('output')
		const limitSaved = settingsSaved(page)

		await main.getByRole('button', { name: 'More cards' }).click()
		await main.getByRole('button', { name: 'More cards' }).click()
		await main.getByRole('button', { name: 'Fewer cards' }).click()
		await expect(limit).toHaveText('6')
		const limitAnswer = await limitSaved

		expect(limitAnswer.ok()).toBe(true)

		const batchSaved = settingsSaved(page)

		await main.getByLabel('Night run at').fill('05:45')
		const batchAnswer = await batchSaved

		expect(batchAnswer.ok()).toBe(true)

		const zoneSaved = settingsSaved(page)

		await main.getByLabel('Time zone').selectOption('Asia/Tokyo')
		const zoneAnswer = await zoneSaved

		expect(zoneAnswer.ok()).toBe(true)

		await page.reload()
		await expect(limit).toHaveText('6')
		await expect(main.getByLabel('Night run at')).toHaveValue('05:45')
		await expect(main.getByLabel('Time zone')).toHaveValue('Asia/Tokyo')
	})

	test('tests the agent command from the engines page', async ({ page }) => {
		await page.setViewportSize({ width: 1440, height: 900 })
		await open(page, '/settings')

		const nav = page.getByRole('navigation', { name: 'Settings sections' })

		await expect(nav.getByRole('link', { name: 'Digest' })).toHaveAttribute('aria-current', 'true')
		await nav.getByRole('link', { name: 'Engines' }).click()
		await hydrated(page)

		const agent = page.getByRole('article', { name: 'Agent command' })

		await expect(agent).toContainText('Not tested')
		await expect(page.getByRole('article', { name: 'Gemini' })).toContainText('Not set up')
		await expect(page.getByRole('article', { name: 'OpenAI-compatible' })).toContainText(
			'Not set up',
		)

		await agent.getByRole('button', { name: 'Test' }).click()
		await expect(agent).toContainText('Working')
		await expect(agent).toContainText(/Answered in \d+\.\d s/u)
	})

	test('saves an endpoint and a key that never leaves the server', async ({ page }) => {
		const key = `sk-${faker.string.alphanumeric(48)}`

		await page.setViewportSize({ width: 1440, height: 900 })
		await open(page, '/settings/engines/openai-compatible')

		const models = page.getByRole('form', { name: 'Models' })
		const endpointSaved = settingsSaved(page)

		// A closed port: the test after the key fails without reaching any provider.
		await models.getByLabel('Endpoint').fill('http://127.0.0.1:9/v1')
		await models.getByRole('button', { name: 'Save' }).click()
		const endpointAnswer = await endpointSaved

		expect(endpointAnswer.ok()).toBe(true)

		await page.getByRole('button', { name: 'Add a key' }).click()

		const keyField = page.getByLabel('API key')

		await keyField.fill(key)
		await page.getByRole('button', { name: 'Save', exact: true }).first().click()
		await expect(page.getByText('Key saved')).toBeVisible()
		await expect(page.getByText('Could not reach it. The server log has the reason')).toBeVisible()
		await expect(page.getByRole('button', { name: 'Replace' })).toBeVisible()
		expect(await page.content()).not.toContain(key)

		for (const path of ['/settings', '/settings/engines', '/settings/engines/openai-compatible']) {
			// oxlint-disable-next-line no-await-in-loop -- One page after the other.
			await open(page, path)
			// oxlint-disable-next-line no-await-in-loop -- Each page's HTML right after it loads.
			expect(await page.content()).not.toContain(key)
		}

		const settings = await page.request.get(`${origin}/api/settings`)

		expect(await settings.text()).not.toContain(key)
		expect(await settings.text()).toContain('"apiKey":"set"')
	})

	test('adds, moves and deletes categories on the phone', async ({ page }) => {
		await page.setViewportSize({ width: 390, height: 844 })
		await open(page, '/settings/categories/new')

		await page.getByLabel('Name').fill('Cooking')
		await page.getByRole('radio', { name: 'Nature' }).click()
		await page.getByRole('radio', { name: 'Green' }).click()
		await page.getByRole('radio', { name: /^Brief/u }).check()
		await page.getByRole('button', { name: 'Save' }).click()
		await expect(page).toHaveURL(`${origin}/settings/categories`)
		await hydrated(page)

		const grips = page.getByRole('button', { name: /^Move /u })

		await expect(page.getByRole('link', { name: /Cooking/u })).toBeVisible()

		const orderSaved = page.waitForResponse(`${origin}/api/categories/order`)

		await page.getByRole('button', { name: 'Move Cooking' }).focus()
		await page.keyboard.press('Home')
		const order = await orderSaved

		expect(order.ok()).toBe(true)
		await page.reload()
		await expect(grips.first()).toHaveAttribute('aria-label', 'Move Cooking')

		const ids = await categoryIds(page)
		const text = await addNote(page, ids.get('Technology'))

		await open(page, `/settings/categories/${ids.get('Technology')}`)
		await page.getByRole('button', { name: 'Delete category' }).click()

		const dialog = page.getByRole('alertdialog', { name: 'Delete “Technology”?' })

		await dialog.getByRole('combobox', { name: 'Move notes to' }).selectOption({ label: 'Cooking' })
		await dialog.getByRole('button', { name: 'Delete and move' }).click()
		await expect(page).toHaveURL(`${origin}/settings/categories`)

		expect(await categoryOf(page, text)).toBe(ids.get('Cooking'))

		const left = await categoryIds(page)

		expect(left.has('Technology')).toBe(false)
	})

	test('adds a device whose token shows once, then revokes it', async ({ page }) => {
		await page.setViewportSize({ width: 390, height: 844 })
		await open(page, '/settings/devices/new')

		await page.getByLabel('Name').fill('Mac · MCP client')
		await page.getByRole('button', { name: 'Create' }).click()

		const shown = page.locator('code')

		await expect(shown).toHaveText(/^sp1_\S+$/u)

		const shownText = await shown.textContent()
		const token = shownText?.trim() ?? ''
		const hint = `sp1_…${token.slice(-4)}`

		await page.getByRole('button', { name: 'Done' }).click()
		await expect(page).toHaveURL(`${origin}/settings/devices`)
		await hydrated(page)
		await expect(page.getByText(`Never used · ${hint}`)).toBeVisible()
		expect(await page.content()).not.toContain(token)

		expect(await statusWith(token, '/api/notes')).toBe(200)
		expect(await statusWith(token, '/api/settings')).toBe(403)
		expect(await statusWith(token, '/api/engines/agent-command/test', 'POST')).toBe(403)

		await page.getByRole('button', { name: 'Revoke Mac · MCP client' }).click()

		const dialog = page.getByRole('alertdialog', { name: 'Revoke “Mac · MCP client”?' })
		const revoked = page.waitForResponse((response) => response.request().method() === 'DELETE')

		await dialog.getByRole('button', { name: 'Revoke' }).click()
		const revoke = await revoked

		expect(revoke.status()).toBe(204)
		await expect(page.getByText('Mac · MCP client')).toHaveCount(0)
		expect(await statusWith(token, '/api/notes')).toBe(401)
	})

	test('matches the boards on the phone', async ({ page }) => {
		const ids = await categoryIds(page)

		const frames = [
			['01', '/settings'],
			['02', '/settings/categories'],
			['03', `/settings/categories/${ids.get('Cooking')}`],
			['05', '/settings/engines'],
			['07', '/settings/engines/gemini'],
			['08', '/settings/devices'],
			['09', '/settings/devices/new'],
			['10', '/settings/integrations'],
		] as const

		await page.setViewportSize({ width: 390, height: 844 })

		for (const scheme of ['light', 'dark'] as const) {
			// oxlint-disable-next-line no-await-in-loop -- One scheme after the other, on one page.
			await page.emulateMedia({ colorScheme: scheme })

			for (const [frame, path] of frames) {
				// oxlint-disable-next-line no-await-in-loop -- One frame after the other, on one page.
				await open(page, path)
				// oxlint-disable-next-line no-await-in-loop -- Each screenshot right after its frame.
				await attach(page, `390-${scheme}-${frame}`)
			}
		}
	})

	test('matches the boards on the tablet and the desktop', async ({ page }) => {
		const ids = await categoryIds(page)

		const frames = [
			['01', '/settings'],
			['02', `/settings/categories/${ids.get('Cooking')}`],
			['03', '/settings/engines'],
			['04', '/settings/devices'],
		] as const

		for (const width of [768, 1440]) {
			// oxlint-disable-next-line no-await-in-loop -- One width after the other, on one page.
			await page.setViewportSize({ width, height: 900 })

			for (const scheme of ['light', 'dark'] as const) {
				// oxlint-disable-next-line no-await-in-loop -- One scheme after the other.
				await page.emulateMedia({ colorScheme: scheme })

				for (const [frame, path] of frames) {
					// oxlint-disable-next-line no-await-in-loop -- One frame after the other.
					await open(page, path)
					// oxlint-disable-next-line no-await-in-loop -- Each screenshot right after its frame.
					await attach(page, `${width}-${scheme}-${frame}`)
				}
			}
		}
	})
})
