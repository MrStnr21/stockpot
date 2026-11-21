// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import type { ComponentProps } from 'svelte'

import SwipeActionsStory from './swipe-actions.story.svelte'

export default { component: SwipeActionsStory }

export const Closed = {
	args: { group: 'closed' } satisfies ComponentProps<typeof SwipeActionsStory>,
}

export const SwipedLeft = {
	args: { group: 'end' } satisfies ComponentProps<typeof SwipeActionsStory>,
}

export const SwipedRight = {
	args: { group: 'start' } satisfies ComponentProps<typeof SwipeActionsStory>,
}

export const Pressed = {
	args: { group: 'pressed' } satisfies ComponentProps<typeof SwipeActionsStory>,
}

export const Disabled = {
	args: { group: 'disabled' } satisfies ComponentProps<typeof SwipeActionsStory>,
}

export const Loading = {
	args: { group: 'loading' } satisfies ComponentProps<typeof SwipeActionsStory>,
}
