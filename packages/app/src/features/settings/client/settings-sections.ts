// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import type { IconName } from '@stockpot/ui/icon'

export type SettingsSection =
	'digest' | 'categories' | 'engines' | 'devices' | 'integrations' | 'app' | 'account' | 'about'

export interface SectionLink {
	readonly key: SettingsSection
	readonly href: string
	readonly icon: IconName
}

/** The sections the settings nav lists from 768 px, in the board's order. */
export const settingsSections: readonly SectionLink[] = [
	{ key: 'digest', href: '/settings', icon: 'sun' },
	{ key: 'categories', href: '/settings/categories', icon: 'tag' },
	{ key: 'engines', href: '/settings/engines', icon: 'bolt' },
	{ key: 'devices', href: '/settings/devices', icon: 'phone' },
	{ key: 'integrations', href: '/settings/integrations', icon: 'link' },
	{ key: 'app', href: '/settings/app', icon: 'sliders' },
	{ key: 'account', href: '/settings/account', icon: 'lock' },
	{ key: 'about', href: '/settings/about', icon: 'pot' },
]
