// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import type { ComponentProps } from 'svelte'

import SpinnerStory from './spinner.story.svelte'

export default { component: SpinnerStory }

export const Small = { args: { size: 'sm' } satisfies ComponentProps<typeof SpinnerStory> }

export const Medium = { args: { size: 'md' } satisfies ComponentProps<typeof SpinnerStory> }
