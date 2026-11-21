// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import WordmarkStory from './wordmark.story.svelte'

export default { component: WordmarkStory }

export const Default = { args: {} }

export const WithTagline = {
	args: { tagline: 'Toss in the scraps of your day. Wake up to broth.' },
}
