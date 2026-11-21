// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

/*
 * `bun run icons`: renders the PNG icons from public/icons/icon.svg with Chromium, which Playwright
 * already installs for the end-to-end specs. The PNGs are committed; run this only after the SVG changes.
 */
import { file, write } from 'bun'
import { chromium } from '@playwright/test'

const folder = new URL('../public/icons/', import.meta.url).pathname

const source = await file(`${folder}icon.svg`).text()

// The maskable icon is the same full-bleed square: the glyph already sits inside the 80% safe zone.
const targets = [
	{ name: 'apple-touch-icon.png', size: 180 },
	{ name: 'icon-192.png', size: 192 },
	{ name: 'icon-512.png', size: 512 },
	{ name: 'icon-maskable-512.png', size: 512 },
] as const

const browser = await chromium.launch()

try {
	for (const { name, size } of targets) {
		// oxlint-disable-next-line eslint/no-await-in-loop -- Four small renders through one page at a time.
		const page = await browser.newPage({ viewport: { width: size, height: size } })

		// oxlint-disable-next-line eslint/no-await-in-loop -- Same.
		await page.setContent(
			`<style>html,body{margin:0}svg{display:block;width:${size}px;height:${size}px}</style>${source}`,
		)
		// oxlint-disable-next-line eslint/no-await-in-loop -- Same.
		await write(`${folder}${name}`, await page.screenshot({ type: 'png' }))
		// oxlint-disable-next-line eslint/no-await-in-loop -- Same.
		await page.close()
	}
} finally {
	await browser.close()
}
