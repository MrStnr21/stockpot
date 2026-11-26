// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import type { ComponentProps } from 'svelte'

import StatusBadgeStory from './status-badge.story.svelte'

export default { component: StatusBadgeStory }

export const Statuses = {
	args: { group: 'statuses' } satisfies ComponentProps<typeof StatusBadgeStory>,
}

export const Flags = { args: { group: 'flags' } satisfies ComponentProps<typeof StatusBadgeStory> }

export const Neutral = {
	args: { group: 'neutral' } satisfies ComponentProps<typeof StatusBadgeStory>,
}
