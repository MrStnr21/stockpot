// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import type { ComponentProps } from 'svelte'

import ToastStory from './toast.story.svelte'

export default { component: ToastStory }

type StoryArgs = ComponentProps<typeof ToastStory>

export const Default = { args: { group: 'default' } satisfies StoryArgs }

export const Pressed = { args: { group: 'pressed' } satisfies StoryArgs }

export const Disabled = { args: { group: 'disabled' } satisfies StoryArgs }

export const Loading = { args: { group: 'loading' } satisfies StoryArgs }

export const Ready = { args: { group: 'ready' } satisfies StoryArgs }

export const Error = { args: { group: 'error' } satisfies StoryArgs }
