// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import type { ComponentProps } from 'svelte'

import SegmentedStory from './segmented.story.svelte'

export default { component: SegmentedStory }

export const States = { args: { group: 'states' } satisfies ComponentProps<typeof SegmentedStory> }

export const LevelSets = {
	args: { group: 'level-sets' } satisfies ComponentProps<typeof SegmentedStory>,
}
