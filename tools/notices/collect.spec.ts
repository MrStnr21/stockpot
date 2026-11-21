// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { CryptoHasher } from 'bun'
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { collectFonts } from './collect'

const bytes = new Uint8Array([1, 2, 3])

const digest = new CryptoHasher('sha256').update(bytes).digest('hex')

describe('collectFonts', () => {
	let directory = ''

	async function addFont(sha: string) {
		await mkdir(join(directory, 'serif'))
		await writeFile(join(directory, 'serif', 'Serif.woff2'), bytes)
		await writeFile(join(directory, 'serif', 'OFL.txt'), 'Copyright 2020 The Serif Authors\n')

		await writeFile(
			join(directory, 'serif', 'font.json'),
			JSON.stringify({
				name: 'Serif',
				version: '2.0',
				license: 'OFL-1.1',
				source: 'https://example.com/serif',
				files: { 'Serif.woff2': sha },
			}),
		)
	}

	beforeEach(async () => {
		directory = await mkdtemp(join(tmpdir(), 'fonts-'))
	})

	afterEach(async () => {
		await rm(directory, { recursive: true })
	})

	it('reads the manifest and the licence text', async () => {
		await addFont(digest)

		expect(await collectFonts(directory)).toEqual([
			{
				name: 'Serif',
				version: '2.0',
				license: 'OFL-1.1',
				source: 'https://example.com/serif',
				licenseText: 'Copyright 2020 The Serif Authors\n',
			},
		])
	})

	it('fails when a file differs from its recorded SHA-256', async () => {
		await addFont('0'.repeat(64))

		expect(collectFonts(directory)).rejects.toThrow('Serif.woff2')
	})

	it('fails when a font file is not listed in font.json', async () => {
		await addFont(digest)
		await writeFile(join(directory, 'serif', 'Serif-Italic.woff2'), bytes)

		expect(collectFonts(directory)).rejects.toThrow('Serif-Italic.woff2')
	})

	it('finds nothing in a folder without fonts', async () => {
		expect(await collectFonts(directory)).toEqual([])
	})
})
