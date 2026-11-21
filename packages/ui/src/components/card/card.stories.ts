// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import type { ComponentProps } from 'svelte'

import CardStory from './card.story.svelte'

export default { component: CardStory }

export const Default = { args: { group: 'default' } satisfies ComponentProps<typeof CardStory> }

export const Pressed = { args: { group: 'pressed' } satisfies ComponentProps<typeof CardStory> }

export const Disabled = { args: { group: 'disabled' } satisfies ComponentProps<typeof CardStory> }

export const Loading = { args: { group: 'loading' } satisfies ComponentProps<typeof CardStory> }
