// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import type { ComponentProps } from 'svelte'

import TabBarStory from './tab-bar.story.svelte'

export default { component: TabBarStory }

type StoryArgs = ComponentProps<typeof TabBarStory>

export const Default = { args: { group: 'default' } satisfies StoryArgs }

export const Pressed = { args: { group: 'pressed' } satisfies StoryArgs }

export const Badge = { args: { group: 'badge' } satisfies StoryArgs }
