// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

/*
 * What a Base section draws for a group of kept notes: its heading's name and look, and the key
 * the controller keeps its expanded rows under.
 */
import type { Messages } from '#/lib/i18n/en'

import type { BaseGroup, NotesCategory } from '../shared/types'
import type { GroupKey } from './base-api'
import { otherLook, type CategoryLook } from './row-view'

export type BaseStrings = Messages['base']

export interface GroupView {
	readonly key: GroupKey
	readonly label: string
	readonly look: CategoryLook
}

/** The key of a group: its category's id, or `'none'` for the uncategorized notes. */
export function groupKey(categoryId: number | null): GroupKey {
	return categoryId ?? 'none'
}

/**
 * A group's name and look. The uncategorized group, and a category the page does not know, read
 * "No category" with the Other look.
 */
export function groupView(
	group: Pick<BaseGroup, 'categoryId'>,
	categories: ReadonlyMap<number, NotesCategory>,
	strings: Pick<BaseStrings, 'noCategory'>,
): GroupView {
	const category = group.categoryId === null ? undefined : categories.get(group.categoryId)

	return {
		key: groupKey(group.categoryId),
		label: category?.name ?? strings.noCategory,
		look: category === undefined ? otherLook : { color: category.color, icon: category.icon },
	}
}

/** Whether a group keeps more notes than its preview shows, so "Show all" has more to show. */
export function canShowAll(group: Pick<BaseGroup, 'count' | 'notes'>): boolean {
	return group.count > group.notes.length
}

/**
 * Whether the page came back through the history (Back or Forward). The browser may then serve the
 * page from its HTTP cache, rendered before the latest Keep: its rows are to be loaded again.
 */
export function cameBack(entries: readonly object[]): boolean {
	return entries.some((entry) => 'type' in entry && entry.type === 'back_forward')
}
