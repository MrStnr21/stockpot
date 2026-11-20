// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import type { LinkOutcome } from '#/server/links/open-link'

import type { Source } from '../shared/formats'

interface CardWithSources {
	readonly sources: readonly Source[]
	readonly uncertain: boolean
}

type CheckedCard<T extends CardWithSources> = {
	[K in keyof T]: K extends 'sources'
		? T['sources'][number][]
		: K extends 'uncertain'
			? boolean
			: T[K]
}

interface CheckSourcesOptions {
	readonly open: (url: string, signal: AbortSignal) => Promise<LinkOutcome>
	readonly signal: AbortSignal
}

function isGroundingRedirect(address: string): boolean {
	const url = URL.parse(address)

	return (
		url?.protocol === 'https:' &&
		url.hostname === 'vertexaisearch.cloud.google.com' &&
		url.pathname.startsWith('/grounding-api-redirect/')
	)
}

export function checkSources<T extends CardWithSources>(
	card: T,
	options: CheckSourcesOptions,
): Promise<CheckedCard<T>>
export async function checkSources(
	card: CardWithSources,
	{ open, signal }: CheckSourcesOptions,
): Promise<CardWithSources> {
	signal.throwIfAborted()

	const unique = new Map<string, Source>()

	for (const source of card.sources) {
		if (!unique.has(source.url)) {
			unique.set(source.url, source)
		}
	}

	const checked = await Promise.all(
		Array.from(unique.values(), async (source) => {
			// The search grounding terms leave opening these redirects to the owner.
			if (isGroundingRedirect(source.url)) {
				return source
			}

			const outcome = await open(source.url, signal)

			return outcome.kind === 'open' ? source : null
		}),
	)

	signal.throwIfAborted()

	const sources = checked.filter((source) => source !== null)

	return { ...card, sources, uncertain: card.uncertain || sources.length === 0 }
}
