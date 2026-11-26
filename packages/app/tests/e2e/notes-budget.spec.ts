// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { faker } from '@faker-js/faker'
import { expect, test, type Page } from '@playwright/test'

import { ownerServer } from './owner-server'
import { seedNotes } from './seed-notes'

const { origin, startServer, createOwner } = ownerServer(7)

const password = faker.internet.password({ length: 16 })

const noteCount = 1000

const warmUps = 3

const runs = 20

/** The nearest-rank percentile: the p95 of 20 runs is the 19th fastest. */
function percentile(times: readonly number[], share: number) {
	const sorted = times.toSorted((a, b) => a - b)

	return sorted[Math.ceil(share * sorted.length) - 1] ?? Number.POSITIVE_INFINITY
}

/** Milliseconds from sending the request to the last byte of the page, after `warmUps` untimed runs. */
async function timePage(page: Page, path: string) {
	const times: number[] = []
	const statuses: number[] = []

	for (let index = 0; index < warmUps + runs; index += 1) {
		const start = performance.now()
		// A redirect to sign-in would answer fast without the list, so none is followed.
		// oxlint-disable-next-line no-await-in-loop -- Timed one at a time, as a browser asks for a page.
		const response = await page.request.get(`${origin}${path}`, { maxRedirects: 0 })

		// oxlint-disable-next-line no-await-in-loop -- The body is part of the time.
		await response.body()
		times.push(performance.now() - start)
		statuses.push(response.status())
	}

	const timed = times.slice(warmUps)

	return { statuses, median: percentile(timed, 0.5), p95: percentile(timed, 0.95) }
}

function rows(page: Page) {
	return page.getByRole('main').getByRole('listitem')
}

test.describe('notes list with 1,000 notes', () => {
	let stopServer: (() => Promise<void>) | null = null
	let searchPath: string | null = null

	test.beforeEach(async ({ page }) => {
		const server = await startServer(test.info().config.configFile ?? '')

		stopServer = server.stop
		await createOwner(page, server.code, password)
		searchPath = `/notes?q=${seedNotes(server.dataDir, noteCount)}`
	})

	test.afterEach(async () => {
		await stopServer?.()
	})

	test('renders the page under 200 ms and pages through it at 390 px', async ({ page }) => {
		const search = searchPath ?? ''

		const timings = [
			{ name: '/notes', ...(await timePage(page, '/notes')) },
			{ name: search, ...(await timePage(page, search)) },
		]

		for (const { name, statuses, median, p95 } of timings) {
			test.info().annotations.push({
				type: 'timing',
				description: `${name}: median ${median.toFixed(1)} ms, p95 ${p95.toFixed(1)} ms`,
			})
			expect(statuses, name).toEqual(Array.from({ length: warmUps + runs }, () => 200))
			expect(p95, name).toBeLessThan(200)
		}

		await page.setViewportSize({ width: 390, height: 844 })
		await page.goto(`${origin}/notes`)
		await expect(page.locator('astro-island[client="load"]:not([ssr])')).toHaveCount(1)
		await expect(rows(page)).toHaveCount(50)

		await page.getByRole('button', { name: 'Show more' }).scrollIntoViewIfNeeded()

		await expect(rows(page)).toHaveCount(100)

		const titles = await rows(page).locator('.text-list-title').allInnerTexts()

		expect(new Set(titles).size).toBe(titles.length)
	})
})
