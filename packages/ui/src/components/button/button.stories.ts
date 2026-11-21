// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import type { ComponentProps } from 'svelte'

import ButtonStory from './button.story.svelte'

export default { component: ButtonStory }

type StoryArgs = ComponentProps<typeof ButtonStory>

export const Variants = { args: { group: 'variants' } satisfies StoryArgs }

export const Sizes = { args: { group: 'sizes' } satisfies StoryArgs }

export const Loading = { args: { group: 'loading' } satisfies StoryArgs }
