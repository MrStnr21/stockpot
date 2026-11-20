// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { openLink, type LinkCheckOptions } from '#/server/links/open-link'

import type { CheckResult } from './checks'

export type { Fetch, LinkCheckOptions, Lookup } from '#/server/links/open-link'

export async function checkLinks(
	links: readonly string[],
	options: LinkCheckOptions = {},
): Promise<CheckResult | null> {
	if (links.length === 0) {
		return null
	}

	const outcomes = await Promise.all(
		links.map(async (link) => ({ link, outcome: await openLink(link, options) })),
	)

	const failures = outcomes.flatMap(({ link, outcome }) =>
		outcome.kind === 'open' ? [] : [`${link}: ${outcome.reason}`],
	)

	return failures.length === 0
		? { check: 'links', passed: true, detail: null }
		: { check: 'links', passed: false, detail: failures.join('; ') }
}
