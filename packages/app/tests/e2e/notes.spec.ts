// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { which } from 'bun'
import { faker } from '@faker-js/faker'
import { expect, test, type Page } from '@playwright/test'
import * as v from 'valibot'

import { ownerServer, routeToAgentCommand } from './owner-server'

const { origin, startServer, createOwner } = ownerServer(6)

const password = faker.internet.password({ length: 16 })

/*
 * Suggestions come from the fake agent; any other call it gets never answers, so the one research job
 * a spec starts on purpose keeps the job runner busy and the notes queued after it stay `queued`.
 */
const agentCommand = `${which('bun') ?? 'bun'} '${import.meta.dirname}/fake-agent.ts' --hold`

/* The web app's own requests carry the session cookie and its origin. */
const webApp = { headers: { origin } }

const savedNote = v.object({ id: v.number(), text: v.string() })

const researchResult = v.object({ id: v.number(), outcome: v.string() })

const researchAnswer = v.object({ results: v.array(researchResult) })

const researchState = v.object({ status: v.string() })

/** A note text no other note's text contains. */
function noteText() {
	return `${faker.word.noun()} ${faker.string.alpha({ length: 8, casing: 'lower' })}`
}

async function addNote(page: Page, text: string, context: string | null = null) {
	const response = await page.request.post(`${origin}/api/notes`, {
		...webApp,
		data: { text, context },
	})

	expect(response.status()).toBe(201)

	return v.parse(savedNote, await response.json())
}

async function statusOf(page: Page, id: number) {
	const response = await page.request.get(`${origin}/api/notes/${id}/research`)

	return v.parse(researchState, await response.json()).status
}

/*
 * The worker runs one job at a time: a note whose research the fake agent holds keeps it busy. The
 * note is deleted once its job runs, so it leaves the list.
 */
async function holdJobRunner(page: Page) {
	const { id } = await addNote(page, noteText())

	const queued = await page.request.post(`${origin}/api/notes/${id}/research`, webApp)

	expect(queued.status()).toBe(202)
	await expect.poll(async () => statusOf(page, id)).toBe('researching')

	const deleted = await page.request.delete(`${origin}/api/notes/${id}`, webApp)

	expect(deleted.ok()).toBe(true)
}

/**
 * The list and the card pane inside it are islands loaded with the page; until they hydrate, Select
 * and the chips do nothing.
 */
async function openNotes(page: Page) {
	await page.goto(`${origin}/notes`)
	await expect(page.locator('astro-island[client="load"]:not([ssr])')).toHaveCount(2)
}

function rows(page: Page) {
	return page.getByRole('main').getByRole('listitem')
}

test.describe('notes list', () => {
	let stopServer: (() => Promise<void>) | null = null

	/* A server per test, so each one counts only the notes it adds. */
	test.beforeEach(async ({ page }) => {
		const server = await startServer(test.info().config.configFile ?? '', {
			STOCKPOT_AGENT_COMMAND: agentCommand,
		})

		stopServer = server.stop
		await createOwner(page, server.code, password)
		routeToAgentCommand(server.dataDir)
	})

	test.afterEach(async () => {
		await stopServer?.()
	})

	test('researches two selected notes at 390 px', async ({ page }) => {
		await page.setViewportSize({ width: 390, height: 844 })
		await holdJobRunner(page)

		const texts = [noteText(), noteText(), noteText()]
		const notes = []

		for (const text of texts) {
			// oxlint-disable-next-line no-await-in-loop -- One at a time keeps their order newest first.
			notes.push(await addNote(page, text))
		}

		const picked = notes.slice(1)

		await openNotes(page)

		const today = page
			.getByRole('main')
			.locator('section')
			.filter({ has: page.getByRole('heading', { level: 2, name: 'Today' }) })

		await expect(today.getByRole('listitem')).toHaveCount(3)
		await expect(today.getByRole('listitem')).toContainText(texts.toReversed())

		await page.getByRole('button', { name: 'Select', exact: true }).click()

		for (const { text } of picked) {
			const row = page.getByRole('checkbox', { name: text })

			// oxlint-disable-next-line no-await-in-loop -- Taps come one after the other.
			await row.click()
			// oxlint-disable-next-line no-await-in-loop -- Taps come one after the other.
			await expect(row).toHaveAttribute('aria-checked', 'true')
		}

		await expect(page.getByRole('heading', { level: 1 })).toHaveText('2 selected')

		const toolbar = page.getByRole('toolbar', { name: 'Selected notes' })

		const answered = page.waitForResponse(
			(response) =>
				response.url() === `${origin}/api/notes/research` && response.request().method() === 'POST',
		)

		await toolbar.getByRole('button', { name: 'Research now' }).click()

		const response = await answered

		expect(response.status()).toBe(200)
		expect(v.parse(researchAnswer, await response.json()).results).toEqual(
			picked.map(({ id }) => ({ id, outcome: 'queued' })),
		)

		await Promise.all(
			picked.map(async ({ text }) =>
				expect(page.getByRole('link', { name: text })).toContainText('Queued'),
			),
		)
		await expect(toolbar).toBeHidden()
		expect(await Promise.all(picked.map(async ({ id }) => statusOf(page, id)))).not.toContain('new')

		await page.getByRole('button', { name: /^Queued/u }).click()

		await expect(rows(page)).toHaveCount(2)
		await expect(rows(page)).toContainText(picked.map(({ text }) => text).toReversed())
	})

	test('finds a note by a prefix of its context at 390 px', async ({ page }) => {
		await page.setViewportSize({ width: 390, height: 844 })

		const word = faker.string.alpha({ length: 12, casing: 'lower' })
		const prefix = word.slice(0, 6)
		const found = noteText()

		await addNote(page, noteText(), faker.lorem.sentence())
		await addNote(page, found, `${faker.lorem.sentence()} ${word} ${faker.lorem.word()}`)
		await addNote(page, noteText())
		await openNotes(page)
		await expect(rows(page)).toHaveCount(3)

		await page.getByRole('searchbox', { name: 'Search notes and cards' }).fill(prefix)

		await expect(page.getByText('1 result in notes and cards')).toBeVisible()
		await expect(rows(page)).toHaveCount(1)
		await expect(rows(page)).toContainText(found)
		await expect(rows(page).locator('mark')).toHaveText(new RegExp(`^${prefix}`, 'u'))

		await page.getByRole('button', { name: 'Clear search' }).click()

		await expect(rows(page)).toHaveCount(3)
	})

	test('archives a selected note from the pane at 1440 px', async ({ page }) => {
		await page.setViewportSize({ width: 1440, height: 900 })

		const kept = await addNote(page, noteText())
		const archived = await addNote(page, noteText())

		await openNotes(page)
		await page.getByRole('button', { name: 'Select', exact: true }).click()
		await page.getByRole('checkbox', { name: archived.text }).click()

		await expect(page.getByText('1 note selected')).toBeVisible()

		await page.getByRole('button', { name: 'Archive' }).click()

		await expect(page.getByRole('link', { name: archived.text })).toContainText('Archived')

		await page.getByRole('button', { name: /^New/u }).click()

		await expect(page.getByRole('link', { name: archived.text })).toHaveCount(0)
		await expect(page.getByRole('link', { name: kept.text })).toBeVisible()
	})

	test('lists a note saved from the capture sheet without a reload', async ({ page }) => {
		await page.setViewportSize({ width: 1440, height: 900 })

		const text = noteText()
		const loads: string[] = []

		await openNotes(page)
		await expect(page.locator('astro-island[client="idle"]:not([ssr])')).toHaveCount(1)
		page.on('load', () => {
			loads.push(page.url())
		})

		const sheet = page.getByRole('dialog', { name: 'New note' })

		await page.keyboard.press('n')
		await sheet.getByRole('textbox', { name: 'Word, term or idea' }).fill(text)
		await sheet.getByRole('button', { name: 'Save', exact: true }).click()

		await expect(page.getByRole('link', { name: text })).toBeVisible()
		expect(loads).toEqual([])
	})
})
