// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { formatIds, isFormatId, type FormatId } from '#/lib/format-ids'
import type { SettingsMessages } from '#/lib/i18n/settings-en'

type FormatStrings = SettingsMessages['formats']

/** A format's name and its one-line description, as the editor's radios show them. */
export function formatLabel(
	format: FormatId,
	strings: FormatStrings,
): { name: string; text: string } {
	const labels = {
		vocabulary: { name: strings.vocabulary, text: strings.vocabularyText },
		technology: { name: strings.technology, text: strings.technologyText },
		comparison: { name: strings.comparison, text: strings.comparisonText },
		concept: { name: strings.concept, text: strings.conceptText },
		report: { name: strings.report, text: strings.reportText },
		brief: { name: strings.brief, text: strings.briefText },
	} satisfies Record<FormatId, { name: string; text: string }>

	return labels[format]
}

/** The formats in the board's order, each with its name and description. */
export function formatOptions(
	strings: FormatStrings,
): { id: FormatId; name: string; text: string }[] {
	return formatIds.map((id) => {
		const { name, text } = formatLabel(id, strings)

		return { id, name, text }
	})
}

/** A category row's subtitle: "{Format} format · {count} notes". */
export function categorySubtitle(
	{ format, noteCount }: { readonly format: string; readonly noteCount: number },
	strings: Pick<SettingsMessages['categories'], 'row' | 'rowOne'>,
	formats: FormatStrings,
): string {
	const name = isFormatId(format) ? formatLabel(format, formats).name : format

	return (noteCount === 1 ? strings.rowOne : strings.row)
		.replaceAll('{format}', name)
		.replaceAll('{count}', String(noteCount))
}

/** What a screen reader hears after a key moves a category. */
export function positionText(
	template: string,
	name: string,
	{ index, total }: { readonly index: number; readonly total: number },
): string {
	return template
		.replaceAll('{name}', name)
		.replaceAll('{n}', String(index + 1))
		.replaceAll('{total}', String(total))
}

const arrowSteps = new Map([
	['ArrowRight', 1],
	['ArrowDown', 1],
	['ArrowLeft', -1],
	['ArrowUp', -1],
])

/**
 * Where an arrow key takes the choice in a radio group of `count` (WAI-ARIA radio group): the next
 * one for right or down, the previous for left or up, wrapping at the ends; `null` for other keys.
 */
export function radioTarget(index: number, key: string, count: number): number | null {
	const step = arrowSteps.get(key)

	if (key === 'Home') {
		return 0
	}

	if (key === 'End') {
		return count - 1
	}

	return step === undefined ? null : (index + step + count) % count
}
