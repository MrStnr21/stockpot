// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import type { ComponentProps } from 'svelte'

import TextFieldStory from './text-field.story.svelte'

export default { component: TextFieldStory }

export const Capture = {
	args: { group: 'capture' } satisfies ComponentProps<typeof TextFieldStory>,
}

export const Multiline = {
	args: { group: 'multiline' } satisfies ComponentProps<typeof TextFieldStory>,
}
