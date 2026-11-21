// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import type { ComponentProps } from 'svelte'

import ChipStory from './chip.story.svelte'

export default { component: ChipStory }

export const Off = { args: { group: 'off' } satisfies ComponentProps<typeof ChipStory> }

export const Selected = { args: { group: 'selected' } satisfies ComponentProps<typeof ChipStory> }
