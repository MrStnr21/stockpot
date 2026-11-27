// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import type { CategoryColor, IconName } from '@stockpot/ui/icon'

import { readSettings, type Settings } from '#/features/settings/server'
import type { CategoryRow } from '#/features/settings/shared/types'
import { categoryLook } from '#/lib/category-look'
import { formatIds, type FormatId } from '#/lib/format-ids'
import { config } from '#/server/config'
import type { Db } from '#/server/db/client'
import { resolveRoute } from '#/server/engines/router'
import { configuredEngines, type EngineId } from '#/server/engines/settings'

/** What the category editor island starts from: engine ids and states only, never a key. */
export interface CategoryEditorData {
	readonly id: number | null
	readonly initial: {
		readonly name: string
		readonly icon: IconName
		readonly color: CategoryColor
		readonly format: FormatId
		readonly instructions: string
		readonly engine: EngineId | null
	}
	readonly noteCount: number
	readonly others: readonly { readonly id: number; readonly name: string }[]
	/** The engine that writes a category's cards when it has no route of its own. */
	readonly defaultEngine: EngineId | null
	readonly configured: readonly EngineId[]
}

const newCategory = {
	name: '',
	icon: 'other',
	color: 'other',
	format: 'brief',
	instructions: '',
	engine: null,
} as const

function routeOf({ routing }: Settings, id: number) {
	return Object.entries(routing.categories).find(([key]) => key === String(id))?.[1]
}

/**
 * The editor's data for a category, or a new one with `id` null; `null` when there is no such
 * category. The settings, keys included, are read here and only engine ids leave.
 */
export function readCategoryEditor(
	db: Db,
	categories: readonly CategoryRow[],
	id: number | null,
): CategoryEditorData | null {
	const category = id === null ? null : categories.find((row) => row.id === id)

	if (category === undefined) {
		return null
	}

	const settings = readSettings(db)

	const configured = configuredEngines(settings.engines, config.agentCommand)

	// The format does not change which engine comes first, only the tier.
	const { path } = resolveRoute(
		{ task: 'explain', format: 'brief', categoryId: null },
		settings,
		config.agentCommand,
	)

	const others = categories.flatMap((row) =>
		row.id === id ? [] : [{ id: row.id, name: row.name }],
	)

	const base = { noteCount: 0, others, defaultEngine: path.at(0) ?? null, configured }

	if (category === null) {
		return { id: null, initial: newCategory, ...base }
	}

	const look = categoryLook(category.color, category.icon)

	return {
		...base,
		id: category.id,
		initial: {
			name: category.name,
			icon: look.icon,
			color: look.color,
			format: formatIds.find((format) => format === category.format) ?? 'brief',
			instructions: category.instructions,
			engine: routeOf(settings, category.id)?.engine ?? null,
		},
		noteCount: category.noteCount,
	}
}
