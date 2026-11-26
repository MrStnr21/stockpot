// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import type { ComponentProps } from 'svelte'

import ListStory from './list.story.svelte'

export default { component: ListStory }

export const InAList = { args: { group: 'in-list' } satisfies ComponentProps<typeof ListStory> }

export const Pressed = { args: { group: 'pressed' } satisfies ComponentProps<typeof ListStory> }

export const Selected = { args: { group: 'selected' } satisfies ComponentProps<typeof ListStory> }

export const Disabled = { args: { group: 'disabled' } satisfies ComponentProps<typeof ListStory> }

export const Loading = { args: { group: 'loading' } satisfies ComponentProps<typeof ListStory> }

export const TitleTrail = {
	args: { group: 'title-trail' } satisfies ComponentProps<typeof ListStory>,
}

export const SubtitleContent = {
	args: { group: 'subtitle-content' } satisfies ComponentProps<typeof ListStory>,
}

export const Attached = { args: { group: 'attached' } satisfies ComponentProps<typeof ListStory> }

export const Current = { args: { group: 'current' } satisfies ComponentProps<typeof ListStory> }
