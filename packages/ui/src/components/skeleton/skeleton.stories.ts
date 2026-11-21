// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import type { ComponentProps } from 'svelte'

import SkeletonStory from './skeleton.story.svelte'

export default { component: SkeletonStory }

// oxlint-disable-next-line anti-slop/no-shape-in-symbol-names -- The Feedback board labels this example Shapes.
export const Shapes = { args: { group: 'shapes' } satisfies ComponentProps<typeof SkeletonStory> }

export const CardLoading = {
	args: { group: 'card-loading' } satisfies ComponentProps<typeof SkeletonStory>,
}
