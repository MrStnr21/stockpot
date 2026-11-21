// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import type { ComponentProps } from 'svelte'

import CategoryStory from './category.story.svelte'

export default { component: CategoryStory }

export const OnACard = { args: { group: 'on-card' } satisfies ComponentProps<typeof CategoryStory> }

export const Suggested = {
	args: { group: 'suggested' } satisfies ComponentProps<typeof CategoryStory>,
}

export const Picked = { args: { group: 'picked' } satisfies ComponentProps<typeof CategoryStory> }

export const Labels = { args: { group: 'labels' } satisfies ComponentProps<typeof CategoryStory> }

export const Tiles = { args: { group: 'tiles' } satisfies ComponentProps<typeof CategoryStory> }
