// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import type { IconName } from '@stockpot/ui/icon'

export type NavKey = 'today' | 'notes' | 'add' | 'base' | 'settings'

/** The counts each navigation may show; `null` draws nothing, until the page that owns it has one. */
export interface NavCounts {
	readonly today: number | null
	readonly notes: number | null
	readonly base: number | null
}

export interface NavItem {
	readonly key: NavKey
	readonly href: string
	readonly icon: IconName
}

/** The destinations as the phone bar lists them; the rail moves Add to the front. */
export const navItems: readonly NavItem[] = [
	{ key: 'today', href: '/', icon: 'sun' },
	{ key: 'notes', href: '/notes', icon: 'list' },
	{ key: 'add', href: '/add', icon: 'plus' },
	{ key: 'base', href: '/base', icon: 'bookmark' },
	{ key: 'settings', href: '/settings', icon: 'sliders' },
]
