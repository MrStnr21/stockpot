// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { categoryColors, type CategoryColor, type IconName } from '@stockpot/ui/icon'

export { categoryColors } from '@stockpot/ui/icon'

export const categoryIcons = [
	'english',
	'tech',
	'ai',
	'concept',
	'idea',
	'other',
	'book',
	'flag',
	'music',
	'coin',
	'heart',
	'globe',
	'briefcase',
	'film',
	'pin',
	'leaf',
	'flask',
	'pen',
] as const satisfies readonly IconName[]

export interface CategoryLook {
	readonly color: CategoryColor
	readonly icon: IconName
}

/** A stored colour and icon as the kit draws them; one it does not know takes the Other look. */
export function categoryLook(color: string, icon: string): CategoryLook {
	return {
		color: categoryColors.find((known) => known === color) ?? 'other',
		icon: categoryIcons.find((known) => known === icon) ?? 'other',
	}
}
