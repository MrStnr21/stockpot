// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

/*
 * The two-line SPDX header every source file starts with (docs/guidelines/code.md). JSON and Markdown
 * have no comment syntax worth the noise; the LICENSE file covers them.
 */

const sourceExtensions = new Set([
	'astro',
	'cjs',
	'css',
	'html',
	'js',
	'mjs',
	'sh',
	'svelte',
	'toml',
	'ts',
	'yaml',
	'yml',
])

// Comment openers, a shebang or frontmatter fences may come first, so look a few lines in.
const headerLines = 8

export const licenseLine = 'SPDX-License-Identifier: AGPL-3.0-or-later'

const copyrightLine = /SPDX-FileCopyrightText: \d{4}(?:-\d{4})? \S/u

export function needsHeader(path: string): boolean {
	const extension = path.slice(path.lastIndexOf('.') + 1)

	return path.includes('.') && sourceExtensions.has(extension)
}

/** Whether `text` starts with the license line and at least one copyright line (a copied file keeps its own). */
export function hasHeader(text: string): boolean {
	const head = text.split('\n', headerLines)

	return (
		head.some((line) => line.includes(licenseLine)) && head.some((line) => copyrightLine.test(line))
	)
}
