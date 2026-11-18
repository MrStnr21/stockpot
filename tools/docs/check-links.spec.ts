// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { beforeAll, describe, expect, it } from 'bun:test'

import { findBrokenLinks, type BrokenLink } from './check-links.ts'

const trackedFiles = new Set(['README.md', 'docs/guide.md', 'docs/adr/README.md', 'tools/x.ts'])

const resolvingReadme = `# Read me

See [the guide](docs/guide.md), [its setup](docs/guide.md#set-up-the-app),
[the second setup](./docs/guide.md#set-up-the-app-1), [the code](tools/x.ts#L3),
[the docs folder](docs/), [from the root](/docs/guide.md) and [this page](#read-me).
![a diagram](docs/guide.md) <a href="docs/adr">ADRs</a> <a href="docs/guide.md#top">top</a>
<a href='docs/guide.md'>single quotes</a> and [the records](docs/adr/#records).

[guide]: docs/guide.md#the-engine-contract`

const resolvingGuide = `<a id='top'></a>
## Set up the app
## Set up the app
## The \`engine\` contract
### Notes, cards & categories: v0.1!

[Back](../README.md#read-me), [home](/#read-me) and [down](#notes-cards--categories-v01).`

const adrReadme = `# Decisions

## Records`

const skippedReadme = `[site](https://example.com/missing) [plain](http://example.com) [mail](mailto:a@b.c)
Inline \`[code](missing.md)\` stays code.
\`\`\`md
[fenced](missing.md)
# Not a heading
\`\`\`
[back](#not-a-heading)`

const brokenGuide = `# Guide

[gone](missing.md) and [renamed](../README.md#old-title)
[escaped](../../outside.md) [wrong case](../readme.md) <a href='gone.md'>gone</a>
[no readme](../tools/#usage) and [no record](adr/#missing)

[ref]: ./also-missing.md`

describe('findBrokenLinks', () => {
	describe('with links that resolve', () => {
		let broken: BrokenLink[]

		beforeAll(() => {
			const documents = new Map([
				['README.md', resolvingReadme],
				['docs/guide.md', resolvingGuide],
				['docs/adr/README.md', adrReadme],
			])

			broken = findBrokenLinks(documents, trackedFiles)
		})

		it('reports nothing', () => {
			expect(broken).toEqual([])
		})
	})

	describe('with links it does not check', () => {
		let broken: BrokenLink[]

		beforeAll(() => {
			broken = findBrokenLinks(new Map([['README.md', skippedReadme]]), trackedFiles)
		})

		it('ignores web and mail links, code spans and fenced code', () => {
			expect(broken).toEqual([
				{
					source: 'README.md',
					line: 7,
					target: '#not-a-heading',
					reason: 'no heading or anchor #not-a-heading in README.md',
				},
			])
		})
	})

	describe('with broken links', () => {
		let broken: BrokenLink[]

		beforeAll(() => {
			const documents = new Map([
				['README.md', '# Read me'],
				['docs/guide.md', brokenGuide],
				['docs/adr/README.md', adrReadme],
			])

			broken = findBrokenLinks(documents, trackedFiles)
		})

		it('lists each one with its line and reason', () => {
			expect(broken).toEqual([
				{
					source: 'docs/guide.md',
					line: 3,
					target: 'missing.md',
					reason: 'not a tracked file or folder',
				},
				{
					source: 'docs/guide.md',
					line: 3,
					target: '../README.md#old-title',
					reason: 'no heading or anchor #old-title in README.md',
				},
				{
					source: 'docs/guide.md',
					line: 4,
					target: '../../outside.md',
					reason: 'points outside the repository',
				},
				{
					source: 'docs/guide.md',
					line: 4,
					target: '../readme.md',
					reason: 'not a tracked file or folder',
				},
				{
					source: 'docs/guide.md',
					line: 4,
					target: 'gone.md',
					reason: 'not a tracked file or folder',
				},
				{
					source: 'docs/guide.md',
					line: 5,
					target: '../tools/#usage',
					reason: 'no README.md in tools for #usage',
				},
				{
					source: 'docs/guide.md',
					line: 5,
					target: 'adr/#missing',
					reason: 'no heading or anchor #missing in docs/adr/README.md',
				},
				{
					source: 'docs/guide.md',
					line: 7,
					target: './also-missing.md',
					reason: 'not a tracked file or folder',
				},
			])
		})
	})
})
