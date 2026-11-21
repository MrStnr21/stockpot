// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import type { ComponentProps } from 'svelte'

import IconButtonStory from './icon-button.story.svelte'

export default { component: IconButtonStory }

type StoryArgs = ComponentProps<typeof IconButtonStory>

export const Filled = { args: { variant: 'filled' } satisfies StoryArgs }

export const Plain = { args: { variant: 'plain' } satisfies StoryArgs }
