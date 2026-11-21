// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { faker } from '@faker-js/faker'
import { expect, test, type BrowserContext, type Page } from '@playwright/test'

import { ownerServer } from './owner-server'

const { origin, startServer, createOwner } = ownerServer(4)

const password = faker.internet.password({ length: 16 })

/* Playwright's own request log, kept per test, to prove nothing is asked of a Google host. */
function recordHosts(context: BrowserContext, hosts: Set<string>) {
	context.on('request', (request) => {
		hosts.add(new URL(request.url()).hostname)
	})
}

async function signIn(page: Page) {
	await page.goto(`${origin}/signin`)
	await page.getByLabel('Password').fill(password)
	await page.getByRole('button', { name: 'Sign in' }).click()
	await expect(page).toHaveURL(`${origin}/`)
}

/** Waits for the worker to control the page, which is when it can answer a navigation. */
async function controlled(page: Page) {
	await expect
		.poll(async () => page.evaluate(() => navigator.serviceWorker.controller !== null))
		.toBe(true)
}

/** The caches of the origin and the URLs stored in the `pages` one. */
async function cacheState(page: Page) {
	return page.evaluate(async () => {
		const names = await caches.keys()
		const cache = await caches.open('pages')
		const stored = names.includes('pages') ? await cache.keys() : []

		return { names, pages: stored.map((request) => new URL(request.url).pathname) }
	})
}

async function storedPages(page: Page) {
	const state = await cacheState(page)

	return state.pages.toSorted()
}

test.describe('installable app', () => {
	let stopServer: (() => Promise<void>) | null = null
	const hosts = new Set<string>()

	async function killServer() {
		const stop = stopServer

		stopServer = null
		await stop?.()
	}

	test.beforeEach(async ({ browser, context }) => {
		const server = await startServer(test.info().config.configFile ?? '')
		const page = await browser.newPage()

		stopServer = server.stop
		await createOwner(page, server.code, password)
		await page.close()
		hosts.clear()
		recordHosts(context, hosts)
	})

	test.afterEach(async () => {
		await killServer()
		expect([...hosts].filter((host) => host.includes('google'))).toEqual([])
	})

	test('serves the manifest with its fields', async ({ request }) => {
		const response = await request.get(`${origin}/manifest.webmanifest`)

		expect(response.status()).toBe(200)
		expect(response.headers()['content-type']).toContain('manifest+json')
		expect(await response.json()).toEqual({
			id: '/',
			name: 'stockpot',
			short_name: 'stockpot',
			start_url: '/',
			scope: '/',
			display: 'standalone',
			background_color: '#fbf6f8',
			theme_color: '#fffeff',
			icons: [
				{ src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
				{ src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
				{
					src: '/icons/icon-maskable-512.png',
					sizes: '512x512',
					type: 'image/png',
					purpose: 'maskable',
				},
			],
		})
	})

	for (const { name, size } of [
		{ name: 'apple-touch-icon.png', size: 180 },
		{ name: 'icon-192.png', size: 192 },
		{ name: 'icon-512.png', size: 512 },
		{ name: 'icon-maskable-512.png', size: 512 },
	]) {
		test(`serves ${name} as a ${size} px PNG`, async ({ request }) => {
			const response = await request.get(`${origin}/icons/${name}`)
			const body = await response.body()

			expect(response.status()).toBe(200)
			expect(response.headers()['content-type']).toBe('image/png')
			// The IHDR chunk holds the width and the height as big-endian numbers.
			expect([body.readUInt32BE(16), body.readUInt32BE(20)]).toEqual([size, size])
		})
	}

	test('serves the favicon as SVG and the worker as JavaScript', async ({ request }) => {
		const favicon = await request.get(`${origin}/icons/favicon.svg`)
		const worker = await request.get(`${origin}/sw.js`)

		expect(favicon.headers()['content-type']).toContain('image/svg+xml')
		expect(worker.status()).toBe(200)
		expect(worker.headers()['content-type']).toContain('javascript')
	})

	test('declares the app in the head of every page', async ({ page }) => {
		await page.goto(`${origin}/signin`)

		await expect(page.locator('link[rel="manifest"]')).toHaveAttribute(
			'href',
			'/manifest.webmanifest',
		)
		await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute(
			'href',
			'/icons/apple-touch-icon.png',
		)
		await expect(page.locator('link[rel="icon"]')).toHaveAttribute('href', '/icons/favicon.svg')
		await expect(page.locator('meta[name="apple-mobile-web-app-capable"]')).toHaveAttribute(
			'content',
			'yes',
		)
		await expect(page.locator('meta[name="viewport"]')).toHaveAttribute(
			'content',
			/viewport-fit=cover/u,
		)
		await expect(page.locator('link[rel="preload"][as="font"]')).toHaveCount(2)
	})

	test('preloads the fonts the stylesheet uses, once each', async ({ page }) => {
		await page.goto(`${origin}/signin`)

		const preloaded = await page
			.locator('link[rel="preload"][as="font"]')
			.evaluateAll((links) => links.map((link) => link.getAttribute('href')))

		const sheet = await page.evaluate(async () => {
			const href = document.querySelector('link[rel="stylesheet"]')?.getAttribute('href') ?? ''

			const fetched = await fetch(href)

			return fetched.text()
		})

		expect(preloaded).toHaveLength(2)

		for (const url of preloaded) {
			expect(sheet).toContain(`url(${url})`)
		}
	})

	test('takes control of the page and stores Today', async ({ page }) => {
		await signIn(page)
		await controlled(page)
		await page.reload()
		await expect.poll(async () => storedPages(page)).toContain('/')

		const { names } = await cacheState(page)

		expect(names.filter((name) => name.startsWith('assets-'))).toHaveLength(1)
		expect(names).toContain('pages')
	})

	test('does not store any other page', async ({ page }) => {
		await signIn(page)
		await controlled(page)
		await page.goto(`${origin}/settings`)
		await page.goto(`${origin}/base`)
		await page.goto(`${origin}/notes`)
		await page.goto(`${origin}/notes?x=1`)
		await page.goto(`${origin}/`)

		await expect.poll(async () => storedPages(page)).toEqual(['/', '/notes'])
	})

	test('shows the stored Today, styled and with the banner, when the server is unreachable', async ({
		page,
	}) => {
		await signIn(page)
		await controlled(page)
		await page.reload()
		await expect.poll(async () => storedPages(page)).toContain('/')
		await killServer()

		await page.goto(`${origin}/`)

		await expect(page.locator('html')).toHaveAttribute('data-connection', 'offline')
		await expect(page.getByRole('heading', { level: 1, name: 'Today' })).toBeVisible()
		await expect(page.getByRole('status')).toContainText('Server out of reach.')
		await expect(page.getByRole('navigation').getByRole('link')).toHaveCount(4)
		await expect(page.locator('body')).not.toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
		await expect(page.locator('body')).toHaveCSS('font-family', /Inter/u)
	})

	test('shows the offline page when the server is unreachable and nothing is stored', async ({
		page,
	}) => {
		await page.goto(`${origin}/signin`)
		await controlled(page)
		await killServer()

		await page.goto(`${origin}/`)

		await expect(page.locator('html')).toHaveAttribute('data-connection', 'offline')
		await expect(
			page.getByRole('heading', { name: 'Nothing saved for offline reading yet' }),
		).toBeVisible()
		await expect(page.getByRole('status')).toBeVisible()
	})

	test('sends an expired session to sign-in and drops the stored pages', async ({
		context,
		page,
	}) => {
		await signIn(page)
		await controlled(page)
		await page.reload()
		await expect.poll(async () => storedPages(page)).toContain('/')
		await context.clearCookies()

		await page.goto(`${origin}/`)

		await expect(page).toHaveURL(`${origin}/signin`)
		expect(await storedPages(page)).toEqual([])
		await killServer()
		await page.goto(`${origin}/`)
		await expect(
			page.getByRole('heading', { name: 'Nothing saved for offline reading yet' }),
		).toBeVisible()
	})

	test('leaves no page in Cache Storage after sign-out', async ({ page }) => {
		await signIn(page)
		await controlled(page)
		await page.goto(`${origin}/notes`)
		await page.goto(`${origin}/`)
		await expect.poll(async () => storedPages(page)).toEqual(['/', '/notes'])
		await page.goto(`${origin}/settings`)

		await page.getByRole('button', { name: 'Sign out' }).click()

		await expect(page).toHaveURL(`${origin}/signin`)

		const leftover = await page.evaluate(async () => {
			const urls: string[] = []

			for (const name of await caches.keys()) {
				// oxlint-disable-next-line eslint/no-await-in-loop -- A handful of caches, read in order.
				const cache = await caches.open(name)
				// oxlint-disable-next-line eslint/no-await-in-loop -- Same.
				const stored = await cache.keys()

				urls.push(...stored.map((request) => `${name} ${new URL(request.url).pathname}`))
			}

			return urls.filter((entry) => entry.startsWith('pages '))
		})

		expect(leftover).toEqual([])
	})
})
