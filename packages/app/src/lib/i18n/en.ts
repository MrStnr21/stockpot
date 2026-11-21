// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

/** The interface strings, in English: the source of truth for the keys every locale has. */
export const en = {
	nav: {
		label: 'Main',
		today: 'Today',
		notes: 'Notes',
		add: 'Add',
		base: 'Base',
		settings: 'Settings',
	},
	newNote: 'New note',
	sourceCode: 'Source code',
	signOut: 'Sign out',
	offline: {
		title: 'Server out of reach.',
		body: 'Reading works; the actions wait until it is back.',
	},
	today: {
		emptyTitle: 'Nothing to read today',
		empty:
			'No new cards this morning. Save a word, term or idea today, and it is here tomorrow at 08:30.',
		addNote: 'Add a note',
	},
	notes: {
		emptyTitle: 'No notes yet',
		empty: 'The notes you save are listed here.',
	},
	base: {
		emptyTitle: 'Base is empty',
		empty: 'The cards you keep are listed here.',
	},
	settings: {
		emptyTitle: 'Settings are on their way',
		empty: 'Nothing to change here yet.',
	},
	add: {
		emptyTitle: 'Add a note',
		empty: 'Saving a note from this page is on its way.',
	},
} as const

/** The shape of a locale: the keys of `en` at every level, each leaf holding any string. */
export type Messages = {
	[Key in keyof typeof en]: (typeof en)[Key] extends string ? string : Widen<(typeof en)[Key]>
}

type Widen<Section> = { [Key in keyof Section]: string }
