// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import type { ComponentProps } from 'svelte'

import EmptyStateStory from './empty-state.story.svelte'

export default { component: EmptyStateStory }

type StoryArgs = ComponentProps<typeof EmptyStateStory>

export const Default = { args: { group: 'default' } satisfies StoryArgs }

export const ActionStates = { args: { group: 'action-states' } satisfies StoryArgs }

export const NoResults = { args: { group: 'search' } satisfies StoryArgs }

export const Base = { args: { group: 'base' } satisfies StoryArgs }
