// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { beforeAll, describe, expect, it } from 'bun:test'

import { findBrokenLinks, type BrokenLink } from './check-links.ts'

const repositoryPaths = new Set(['README.md', 'docs', 'docs/guide.md', 'docs/adr', 'tools/x.ts'])

async function existsInRepository(path: string) {
	return repositoryPaths.has(path)
}

const resolvingReadme = `# Read me

See [the guide](docs/guide.md), [its setup](docs/guide.md#set-up-the-app),
[the second setup](./docs/guide.md#set-up-the-app-1), [the code](tools/x.ts#L3),
[the docs folder](docs/), [from the root](/docs/guide.md) and [this page](#read-me).
![a diagram](docs/guide.md) <a href="docs/adr">ADRs</a> <a href="docs/guide.md#top">top</a>

[guide]: docs/guide.md#the-engine-contract`

const resolvingGuide = `<a id="top"></a>
## Set up the app
## Set up the app
## The \`engine\` contract
### Notes, cards & categories: v0.1!

[Back](../README.md#read-me) and [down](#notes-cards--categories-v01).`

const skippedReadme = `[site](https://example.com/missing) [plain](http://example.com) [mail](mailto:a@b.c)
Inline \`[code](missing.md)\` stays code.
\`\`\`md
[fenced](missing.md)
# Not a heading
\`\`\`
[back](#not-a-heading)`

const brokenGuide = `# Guide

[gone](missing.md) and [renamed](../README.md#old-title)
[escaped](../../outside.md)

[ref]: ./also-missing.md`

describe('findBrokenLinks', () => {
	describe('with links that resolve', () => {
		let broken: BrokenLink[] = []

		beforeAll(async () => {
			const documents = new Map([
				['README.md', resolvingReadme],
				['docs/guide.md', resolvingGuide],
			])

			broken = await findBrokenLinks(documents, existsInRepository)
		})

		it('reports nothing', () => {
			expect(broken).toEqual([])
		})
	})

	describe('with links it does not check', () => {
		let broken: BrokenLink[] = []

		beforeAll(async () => {
			broken = await findBrokenLinks(new Map([['README.md', skippedReadme]]), existsInRepository)
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
		let broken: BrokenLink[] = []

		beforeAll(async () => {
			const documents = new Map([
				['README.md', '# Read me'],
				['docs/guide.md', brokenGuide],
			])

			broken = await findBrokenLinks(documents, existsInRepository)
		})

		it('lists each one with its line and reason', () => {
			expect(broken).toEqual([
				{
					source: 'docs/guide.md',
					line: 3,
					target: 'missing.md',
					reason: 'no such file or directory',
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
					line: 6,
					target: './also-missing.md',
					reason: 'no such file or directory',
				},
			])
		})
	})
})
