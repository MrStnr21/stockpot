// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import type { ComponentProps } from 'svelte'

import SwitchStory from './switch.story.svelte'

export default { component: SwitchStory }

export const States = { args: { group: 'states' } satisfies ComponentProps<typeof SwitchStory> }

export const ToggleRow = {
	args: { group: 'toggle-row' } satisfies ComponentProps<typeof SwitchStory>,
}
