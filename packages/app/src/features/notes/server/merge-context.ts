// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import type { NewNote } from '#/features/notes/schemas'

type CaptureContext = Pick<NewNote, 'context' | 'url'>

const blankLine = /\r?\n(?:[ \t]*\r?\n)+/u

/** Deduplicate context and URLs independently so a changed link cannot repeat a paragraph. */
export function mergeContext(target: CaptureContext, capture: CaptureContext): string | null {
	const current = target.context ?? ''
	const existing = new Set(current.split(blankLine))
	const { url } = capture

	const additions =
		capture.context?.split(blankLine).filter((part) => part !== '' && !existing.has(part)) ?? []

	if (target.url !== null && url !== null && url !== target.url) {
		const lines = [current, ...additions].join('\n').split(/\r?\n/u)

		if (!lines.includes(url)) {
			additions.push(url)
		}
	}

	return additions.length === 0
		? target.context
		: [current, ...additions].filter(Boolean).join('\n\n')
}
