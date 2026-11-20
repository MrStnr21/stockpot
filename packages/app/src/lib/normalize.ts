// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

/** Only unambiguous abbreviations qualify for bidirectional matching without a database row. */
export const seededAliases = [
	['k8s', 'kubernetes'],
	['i18n', 'internationalization'],
	['l10n', 'localization'],
	['a11y', 'accessibility'],
	['js', 'javascript'],
	['ts', 'typescript'],
	['postgres', 'postgresql'],
] as const

const invariantWords = new Set([
	'news',
	'series',
	'species',
	'physics',
	'mathematics',
	'economics',
	'politics',
	'kubernetes',
	'postgres',
	'jenkins',
	'always',
	'perhaps',
	'whereas',
	'chaos',
	'kudos',
])

/** An engine reads the stored term for private notes, so it keeps its readable singular or plural form. */
export function normalizeTerm(text: string): string | null {
	/* NFKC turns an ellipsis into three periods. Keep it distinguishable until the ends have been
	 * stripped so a leading ellipsis can be removed while a leading period is preserved. */
	const term = text
		.toWellFormed()
		.replaceAll(/[^…]+/gu, (part) => part.normalize('NFKC'))
		.toLowerCase()
		.replaceAll(/[‘’ʼ]/gu, "'")
		.replaceAll(/[‐‑‒–—]/gu, '-')
		.replaceAll(/\s+/gu, ' ')
		.trim()
		.replaceAll(/^[\s"'“”«»„`()[\]{}<>,;:!?…]+|[\s"'“”«»„`()[\]{}<>,;:!?….]+$/gu, '')
		.replaceAll('…', '...')

	return term.length > 0 && term.length <= 80 ? term : null
}

const takesEs = /(?:[sxz]|ch|sh)$/u

function singularForms(word: string): string[] {
	if (word.length < 4 || /(?:ss|us|is)$/u.test(word)) {
		return []
	}

	if (word.endsWith('ies')) {
		return [`${word.slice(0, -3)}y`, word.slice(0, -1)]
	}

	if (word.endsWith('es')) {
		const stem = word.slice(0, -2)

		if (stem.length >= 3 && takesEs.test(stem)) {
			return [stem, word.slice(0, -1)]
		}
	}

	if (word.endsWith('s')) {
		return [word.slice(0, -1)]
	}

	return []
}

function pluralForm(word: string): string {
	if (takesEs.test(word)) {
		return `${word}es`
	}

	if (/[^aeiou]y$/u.test(word)) {
		return `${word.slice(0, -1)}ies`
	}

	return `${word}s`
}

/** Match plurals and seeded aliases at lookup so the stored term keeps its spelling. */
export function termVariants(term: string): string[] {
	const variants = new Set([term])
	const lastWordStart = term.lastIndexOf(' ') + 1
	const word = term.slice(lastWordStart)

	if (/^[a-z]{3,}$/u.test(word) && !invariantWords.has(word)) {
		const prefix = term.slice(0, lastWordStart)
		const singular = singularForms(word)
		const forms = singular.length === 0 ? [pluralForm(word)] : singular

		for (const form of forms) {
			// Invariant words are also reserved against derived spellings, such as `new` producing `news`.
			if (!invariantWords.has(form)) {
				variants.add(`${prefix}${form}`)
			}
		}
	}

	for (const [alias, canonical] of seededAliases) {
		if (term === alias) {
			variants.add(canonical)
		} else if (term === canonical) {
			variants.add(alias)
		}
	}

	return [...variants]
}
