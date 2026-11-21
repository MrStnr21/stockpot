// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

/*
 * Licences a dependency may carry and still ship inside an AGPL-3.0-or-later program: permissive
 * licences, weak copyleft that allows linking, and the GPL family from version 3. Anything else
 * (unknown, proprietary, GPL-2.0-only, non-commercial) fails `bun run notices`.
 */
const compatible = new Set([
	'0BSD',
	'AGPL-3.0',
	'AGPL-3.0-only',
	'AGPL-3.0-or-later',
	'Apache-2.0',
	'BlueOak-1.0.0',
	'BSD-2-Clause',
	'BSD-3-Clause',
	'CC-BY-4.0',
	'CC0-1.0',
	'GPL-3.0-only',
	'GPL-3.0-or-later',
	'ISC',
	'LGPL-2.1-or-later',
	'LGPL-3.0-only',
	'LGPL-3.0-or-later',
	'MIT',
	'MIT-0',
	'MPL-2.0',
	/*
	 * Fonts ship next to the code. OFL-1.1 permits bundling them with any software, which is all we do;
	 * it only forbids selling the fonts alone and requires the licence to travel with them.
	 */
	'OFL-1.1',
	'Python-2.0',
	'Unlicense',
	'Zlib',
])

/**
 * Whether an SPDX expression is compatible: one compatible choice of an `OR`, every part of an `AND`.
 * Parentheses only group here, so `(MIT OR Apache-2.0) AND BSD-3-Clause` reads as written.
 */
export function isCompatible(expression: string): boolean {
	const trimmed = expression.trim().replace(/^\((?<inner>.*)\)$/u, '$<inner>')

	const choices = splitTopLevel(trimmed, ' OR ')

	if (choices.length > 1) {
		return choices.some((choice) => isCompatible(choice))
	}

	const parts = splitTopLevel(trimmed, ' AND ')

	if (parts.length > 1) {
		return parts.every((part) => isCompatible(part))
	}

	return compatible.has(trimmed.replace(/\+$/u, '-or-later'))
}

/** Splits on `separator` outside parentheses. */
function splitTopLevel(expression: string, separator: string): string[] {
	const parts: string[] = []
	let depth = 0
	let start = 0

	for (let index = 0; index < expression.length; index += 1) {
		const character = expression[index]

		if (character === '(') {
			depth += 1
		} else if (character === ')') {
			depth -= 1
		} else if (depth === 0 && expression.startsWith(separator, index)) {
			parts.push(expression.slice(start, index))
			start = index + separator.length
		}
	}

	parts.push(expression.slice(start))

	return parts
}
