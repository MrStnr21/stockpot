// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import type { ComponentProps } from 'svelte'

import IconStory from './icon.story.svelte'

export default { component: IconStory }

export const IconSet = { args: { group: 'set' } satisfies ComponentProps<typeof IconStory> }

export const FullSet = { args: { group: 'full' } satisfies ComponentProps<typeof IconStory> }

export const Sizes = { args: { group: 'sizes' } satisfies ComponentProps<typeof IconStory> }
