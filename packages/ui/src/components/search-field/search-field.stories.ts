// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import type { ComponentProps } from 'svelte'

import SearchFieldStory from './search-field.story.svelte'

export default { component: SearchFieldStory }

export const States = {
	args: { group: 'states' } satisfies ComponentProps<typeof SearchFieldStory>,
}
