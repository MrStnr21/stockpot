// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { describe, expect, it } from 'bun:test'
import { briefCardFactory, sourceFactory } from '#tests/factories/cards'

import type { LinkOutcome } from '#/server/links/open-link'

import { checkSources } from './links'

const opened = { kind: 'open', status: 200 } as const

const groundingUrl = 'https://vertexaisearch.cloud.google.com/grounding-api-redirect/source'

describe('checkSources', () => {
	const { signal } = new AbortController()

	it('checks sources in parallel and keeps open sources in card order', async () => {
		const first = sourceFactory.build()
		const dead = sourceFactory.build()
		const refused = sourceFactory.build()
		const last = sourceFactory.build()
		const card = briefCardFactory.build({ sources: [first, dead, refused, last] })
		const firstLink = Promise.withResolvers<LinkOutcome>()

		const outcomes = new Map<string, LinkOutcome>([
			[dead.url, { kind: 'dead', reason: 'HTTP 404' }],
			[refused.url, { kind: 'refused', reason: 'non-public address' }],
			[last.url, opened],
		])

		const calls: { url: string; sameSignal: boolean }[] = []

		const checked = checkSources(card, {
			signal,
			open: async (url, linkSignal) => {
				calls.push({ url, sameSignal: linkSignal === signal })

				return outcomes.get(url) ?? firstLink.promise
			},
		})

		const started = [...calls]
		firstLink.resolve(opened)

		expect({ card: await checked, started }).toEqual({
			card: { ...card, sources: [first, last] },
			started: card.sources.map(({ url }) => ({ url, sameSignal: true })),
		})
	})

	it('checks a duplicate URL once and keeps the first title', async () => {
		const first = sourceFactory.build()
		const duplicate = sourceFactory.build({ url: first.url })
		const card = briefCardFactory.build({ sources: [first, duplicate] })
		const calls: string[] = []

		const checked = await checkSources(card, {
			signal,
			open: async (url) => {
				calls.push(url)

				return opened
			},
		})

		expect({ card: checked, calls }).toEqual({
			card: { ...card, sources: [first] },
			calls: [first.url],
		})
	})

	it('keeps Gemini grounding redirects without opening them', async () => {
		const grounding = sourceFactory.build({ url: groundingUrl })
		const card = briefCardFactory.build({ sources: [grounding] })

		const checked = await checkSources(card, {
			signal,
			open: async () => {
				throw new Error('A grounding redirect must stay unchecked')
			},
		})

		expect(checked).toEqual(card)
	})

	it.each([
		'http://vertexaisearch.cloud.google.com/grounding-api-redirect/source',
		'https://vertexaisearch.cloud.google.com.example/grounding-api-redirect/source',
		'https://vertexaisearch.cloud.google.com/grounding-api-redirect',
	])('checks %s as an ordinary link', async (url) => {
		const card = briefCardFactory.build({ sources: [sourceFactory.build({ url })] })

		const checked = await checkSources(card, {
			signal,
			open: async () => ({ kind: 'dead', reason: 'HTTP 404' }),
		})

		expect(checked).toEqual({ ...card, sources: [], uncertain: true })
	})

	it('marks a card that came without sources uncertain', async () => {
		const card = briefCardFactory.build({ sources: [] })

		const checked = await checkSources(card, { signal, open: async () => opened })

		expect(checked).toEqual({ ...card, uncertain: true })
	})

	it('keeps a card uncertain when a source opens', async () => {
		const card = briefCardFactory.build({ uncertain: true })

		const checked = await checkSources(card, { signal, open: async () => opened })

		expect(checked).toEqual(card)
	})

	it('propagates a rejected link check', async () => {
		const card = briefCardFactory.build()
		const reason = new Error('Link check stopped')

		const checked = checkSources(card, {
			signal,
			open: async () => {
				throw reason
			},
		})

		expect(checked).rejects.toBe(reason)
	})

	it('rejects an already stopped job even without links to check', async () => {
		const card = briefCardFactory.build({ sources: [] })
		const reason = new Error('Job stopped')

		const checked = checkSources(card, {
			signal: AbortSignal.abort(reason),
			open: async () => opened,
		})

		expect(checked).rejects.toBe(reason)
	})
})
