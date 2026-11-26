// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { faker } from '@faker-js/faker'
import { expect, test, type Page } from '@playwright/test'
import * as v from 'valibot'

import { firstLevelJob, frames, type Frame } from './card-board'
import { ownerServer } from './owner-server'
import { categoryIdOf, seedCards } from './seed-cards'

const { origin, startServer, createOwner } = ownerServer(8)

const password = faker.internet.password({ length: 16 })

/*
 * Each test has a server of its own with the Cards board's notes. The job runner sleeps until a job
 * is enqueued through it or its next planned run, so the queued job seeded straight into the database
 * (frame 08) stays queued for the whole test: no test here enqueues one, except the failed card's Try
 * again, which runs on its own server.
 */

/** Opens a card on its own page once its island has hydrated. */
async function openCard(page: Page, id: number | undefined) {
	await page.goto(`${origin}/notes/${id}`)
	await expect(page.locator('astro-island[client="load"]:not([ssr])')).toHaveCount(1)
}

/** Opens the list with a note's card beside it, once both islands have hydrated. */
async function openPane(page: Page, search: string) {
	await page.goto(`${origin}/notes${search}`)
	await expect(page.locator('astro-island[client="load"]:not([ssr])')).toHaveCount(2)
}

async function checkFrame(page: Page, frame: Frame, id: number | undefined) {
	await openCard(page, id)

	if (frame.tab !== undefined) {
		await page.getByRole('tab', { name: frame.tab }).click()
		await expect(page.getByRole('tab', { name: frame.tab })).toHaveAttribute(
			'aria-selected',
			'true',
		)
	}

	await expect(page.getByRole('heading', { level: 1 })).toHaveText(frame.title)

	for (const text of frame.texts) {
		// oxlint-disable-next-line no-await-in-loop -- Each text of the frame, one after the other.
		await expect(page.getByText(text, { exact: false }).first()).toBeVisible()
	}
}

/** A note's row in the list, by its title. */
function rowLink(page: Page, title: string) {
	return page.getByRole('region', { name: 'Notes' }).getByRole('link', { name: title })
}

async function attach(page: Page, name: string) {
	await test.info().attach(name, {
		body: await page.screenshot({ fullPage: true }),
		contentType: 'image/png',
	})
}

test.describe('opened cards', () => {
	let ids: Map<string, number>
	let dataDir: string
	let stopServer: (() => Promise<void>) | null = null

	test.beforeEach(async ({ page }) => {
		const server = await startServer(test.info().config.configFile ?? '')

		;({ stop: stopServer, dataDir } = server)
		await createOwner(page, server.code, password)
		ids = seedCards(server.dataDir)
	})

	test.afterEach(async () => {
		await stopServer?.()
	})

	test('marks an English card read and keeps it at 390 px', async ({ page }) => {
		await page.setViewportSize({ width: 390, height: 844 })
		await openCard(page, ids.get('01'))

		await expect(page.getByRole('heading', { level: 1 })).toHaveText('serendipity')
		await expect(page.getByRole('heading', { level: 4, name: 'Translation' })).toBeVisible()

		const youglish = page.getByRole('link', { name: /Hear it on YouGlish/u })

		await expect(youglish).toHaveAttribute(
			'href',
			'https://youglish.com/pronounce/serendipity/english',
		)
		await expect(youglish).toHaveAttribute('rel', /noreferrer/u)

		const marked = page.waitForResponse(
			(response) =>
				response.url() === `${origin}/api/notes/${ids.get('01')}` &&
				response.request().method() === 'PATCH',
		)

		await page.getByRole('button', { name: 'Got it' }).click()

		const markedResponse = await marked

		expect(markedResponse.status()).toBe(200)
		await expect(page.locator('[data-status="read"]')).toHaveText('Read')
		await expect(page.getByRole('button', { name: 'Got it' })).toBeDisabled()

		await page.getByRole('button', { name: 'Keep' }).click()
		await expect(page.getByRole('button', { name: 'Kept' })).toBeVisible()
		await openCard(page, ids.get('01'))
		await expect(page.getByRole('button', { name: 'Kept' })).toBeVisible()
	})

	test('deletes a card and brings it back with Undo at 390 px', async ({ page }) => {
		await page.setViewportSize({ width: 390, height: 844 })
		await openCard(page, ids.get('06'))
		await page.getByRole('button', { name: 'Delete' }).click()
		await expect(page.getByRole('heading', { name: 'Note deleted' })).toBeVisible()
		await page.getByRole('button', { name: 'Undo' }).click()
		await expect(page.getByRole('heading', { level: 1 })).toHaveText('Bauhaus')
		await page.goto(`${origin}/notes`)
		await expect(rowLink(page, 'Bauhaus')).toBeVisible()
	})

	test('opens cards beside the list and moves through them with the arrow keys at 1440 px', async ({
		page,
	}) => {
		await page.setViewportSize({ width: 1440, height: 900 })
		await openPane(page, '')
		await expect(page.getByRole('heading', { name: 'Pick a note' })).toBeVisible()

		await rowLink(page, 'Ollama').click()

		const pane = page.locator('main aside')

		const alternative = pane
			.locator('section', { hasText: 'Against the alternatives' })
			.locator('div')
			.first()

		await expect(pane.getByRole('heading', { level: 2 })).toHaveText('Ollama')
		await expect(page).toHaveURL(new RegExp(`note=${ids.get('03')}`, 'u'))

		const [name, pros, cons] = await Promise.all(
			['LM Studio', 'A desktop app with a model browser', 'Closed source'].map(async (text) =>
				alternative.getByText(text).boundingBox(),
			),
		)

		expect([pros?.y, cons?.y]).toEqual([name?.y, name?.y])

		await rowLink(page, 'Ollama').press('ArrowDown')
		await expect(pane.getByRole('heading', { level: 2 })).toHaveText('Idempotency')
		await expect(rowLink(page, 'Idempotency')).toHaveAttribute('aria-current', 'true')
		await expect(rowLink(page, 'Idempotency')).toBeFocused()
	})

	test('offers Try again in the pane when a picked card fails to load at 1440 px', async ({
		page,
	}) => {
		await page.setViewportSize({ width: 1440, height: 900 })
		await openPane(page, '')

		const cardUrl = `${origin}/api/notes/${ids.get('03')}/card`
		const pane = page.locator('main aside')

		await page.route(cardUrl, async (route) => route.abort())
		await rowLink(page, 'Ollama').click()
		await expect(pane.getByRole('heading', { name: 'Couldn’t open this card' })).toBeVisible()
		await expect(rowLink(page, 'Ollama')).toHaveAttribute('aria-current', 'true')

		await page.unroute(cardUrl)
		await rowLink(page, 'Ollama').click()
		await expect(pane.getByRole('heading', { level: 2 })).toHaveText('Ollama')
	})

	test('gives a private English note no YouGlish link', async ({ page }) => {
		await page.setViewportSize({ width: 390, height: 844 })
		await openCard(page, ids.get('private'))
		await expect(page.getByRole('heading', { level: 1 })).toHaveText('a far cry')
		await expect(page.getByText('Private', { exact: true }).first()).toBeVisible()
		await expect(page.getByRole('link', { name: /YouGlish/u })).toHaveCount(0)
	})

	test('tries a failed card again', async ({ page }) => {
		await page.setViewportSize({ width: 390, height: 844 })
		await openCard(page, ids.get('11'))
		await expect(page.getByRole('heading', { name: 'Couldn’t write this card' })).toBeVisible()

		const queued = page.waitForResponse(
			(response) =>
				response.url() === `${origin}/api/notes/${ids.get('11')}/research` &&
				response.request().method() === 'POST',
		)

		await page.getByRole('button', { name: 'Try again' }).click()

		const queuedResponse = await queued

		expect(queuedResponse.status()).toBe(202)
		await expect(page.getByRole('heading', { name: 'Couldn’t write this card' })).toHaveCount(0)
	})

	/** Every frame of Cards · 390 in one scheme, each with its screenshot attached. */
	async function matchPhoneFrames(page: Page, scheme: 'light' | 'dark') {
		await page.setViewportSize({ width: 390, height: 844 })
		await page.emulateMedia({ colorScheme: scheme })

		for (const frame of frames) {
			// oxlint-disable-next-line no-await-in-loop -- One frame after the other, on one page.
			await checkFrame(page, frame, ids.get(frame.key))
			// oxlint-disable-next-line no-await-in-loop -- Each screenshot right after its frame's check.
			await attach(page, `390-${scheme}-${frame.key}`)
		}

		// The queued job of frame 08 is still due and waiting: nothing took it during the test.
		const answer = await page.request.get(`${origin}/api/notes/${ids.get('08')}/card`)
		const [first] = v.parse(firstLevelJob, await answer.json()).levels

		expect(first.job?.state).toBe('queued')
		expect(Date.parse(first.job?.runAt ?? '')).toBeLessThanOrEqual(Date.now())
	}

	/** Notes boards 01 (a card beside the list) and 02 (filtered to Idea) in one scheme. */
	async function matchWideBoards(page: Page, width: 768 | 1440, scheme: 'light' | 'dark') {
		const pane = page.locator('main aside')

		await page.setViewportSize({ width, height: width === 768 ? 1024 : 900 })
		await page.emulateMedia({ colorScheme: scheme })
		await openPane(page, `?note=${ids.get('03')}`)
		await expect(pane.getByRole('heading', { level: 2 })).toHaveText('Ollama')
		await expect(rowLink(page, 'Ollama')).toHaveAttribute('aria-current', 'true')
		await attach(page, `${width}-${scheme}-01`)
		await openPane(page, `?categoryId=${categoryIdOf(dataDir, 'report')}&note=${ids.get('05')}`)
		await expect(pane.getByRole('heading', { level: 2 })).toHaveText(
			'Voice capture from the Action button',
		)
		await expect(
			page.getByRole('region', { name: 'Notes' }).locator('a[href^="/notes/"]'),
		).toHaveCount(2)
		await attach(page, `${width}-${scheme}-02`)
	}

	test('matches every Cards board frame at 390 px in the light scheme', async ({ page }) => {
		await matchPhoneFrames(page, 'light')
	})

	test('matches every Cards board frame at 390 px in the dark scheme', async ({ page }) => {
		await matchPhoneFrames(page, 'dark')
	})

	test('matches the notes and card boards at 768 px in both schemes', async ({ page }) => {
		await matchWideBoards(page, 768, 'light')
		await matchWideBoards(page, 768, 'dark')
	})

	test('matches the notes and card boards at 1440 px in both schemes', async ({ page }) => {
		await matchWideBoards(page, 1440, 'light')
		await matchWideBoards(page, 1440, 'dark')
	})
})
