// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { updateSettingsWith } from '#/features/settings/server'
import type { Db } from '#/server/db/client'
import type { Tier } from '#/server/engines/contract'
import type { EngineId } from '#/server/engines/settings'

export interface CategoryRoute {
	readonly engine: EngineId
	readonly tier: Tier
}

/**
 * Routes one category to an engine, or with `null` back to the default. The other categories'
 * routes are read and written in the same transaction, so two changes in a row both hold.
 */
export function setCategoryRoute(db: Db, categoryId: number, route: CategoryRoute | null): void {
	const key = String(categoryId)

	updateSettingsWith(db, ({ routing }) => {
		const others = Object.entries(routing.categories).filter(([id]) => id !== key)
		const categories = Object.fromEntries(route === null ? others : [...others, [key, route]])

		return { routing: { categories } }
	})
}
