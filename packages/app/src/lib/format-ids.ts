// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

/*
 * The card formats a category can point to (docs/engines.md, "Formats"). The ids live here so that the
 * categories feature can check them; the research feature maps each one to its schemas. Ids are stored
 * with each category, so renaming one needs a migration.
 */

export const formatIds = [
	'vocabulary',
	'technology',
	'comparison',
	'concept',
	'report',
	'brief',
] as const

export type FormatId = (typeof formatIds)[number]

export function isFormatId(value: string): value is FormatId {
	return formatIds.some((id) => id === value)
}
