// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import type { ComponentProps } from 'svelte'

import SheetStory from './sheet.story.svelte'

export default { component: SheetStory }

export const Capture = { args: { group: 'capture' } satisfies ComponentProps<typeof SheetStory> }

export const States = { args: { group: 'states' } satisfies ComponentProps<typeof SheetStory> }

export const Modal = { args: { group: 'modal' } satisfies ComponentProps<typeof SheetStory> }
