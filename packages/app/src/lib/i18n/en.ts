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
	offlinePage: {
		emptyTitle: 'Nothing saved for offline reading yet',
		empty: 'Open Today while the server is reachable, and its latest copy is kept on this device.',
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
	capture: {
		title: 'New note',
		close: 'Close',
		closeHint: 'esc',
		termLabel: 'Word, term or idea',
		termPlaceholder: 'Word, term or idea',
		paste: 'Paste',
		contextLabel: 'Where you saw it',
		contextPlaceholder: 'Where you saw it, or a link',
		pasteLink: 'Paste a link',
		staysOnServer: 'Stays on your server',
		category: 'Category',
		categorySuggesting: 'Category · suggesting',
		categorySuggested: 'Category · suggested',
		categoryAll: 'Category · all',
		categoryHint: 'Suggestions appear as you type',
		allCategories: 'All categories',
		suggested: 'Suggested',
		seenKicker: 'Already seen',
		savedKicker: 'Already saved',
		savedLine: 'It comes in tomorrow’s digest.',
		openCard: 'Open card',
		openNote: 'Open note',
		differentMeaning: 'Different meaning',
		whichMeaning: 'Which meaning?',
		noneOfThese: 'None of these',
		private: 'Private',
		privateOff: 'The engine gets only the term',
		privateOn: 'Only “{term}” goes to the engine',
		save: 'Save',
		researchNow: 'Research now',
		addContext: 'Add context',
		deeperNow: 'Deeper now',
		saveAsRepeat: 'Save as repeat',
		tryAgain: 'Try again',
		repeatCaption: 'Tonight: level 2, first in tomorrow’s digest',
		addContextCaption: 'The new context joins the saved note',
		errorTitle: 'Can’t reach your server.',
		errorBody: 'The note stays here until it saves.',
		statusNew: 'New',
		statusQueued: 'Queued',
		statusResearching: 'Researching',
		statusReady: 'Ready',
		statusRead: 'Read',
		statusArchived: 'Archived',
		savedToast: 'Saved: {term}',
		savedDetail: 'In tomorrow’s digest',
		mergedDetail: 'Added to the saved note',
		researchingToast: 'Researching {term}',
		researchingDetail: 'You’ll get a notification',
		followUpFailed: 'Saved, but research did not start',
		saveFailed: 'Couldn’t save “{term}”',
		removed: 'Removed',
		undoFailed: 'Couldn’t remove the note',
		undo: 'Undo',
		view: 'View',
		kbdSave: '⌘↩',
		kbdResearch: '⇧⌘↩',
		kbdSaveCtrl: 'Ctrl ↵',
		kbdResearchCtrl: 'Shift Ctrl ↵',
	},
	add: {
		emptyTitle: 'Add a note',
		empty: 'Save a word, term or idea, and it comes back explained in tomorrow’s digest.',
	},
} as const

/** The shape of a locale: the keys of `en` at every level, each leaf holding any string. */
export type Messages = {
	[Key in keyof typeof en]: (typeof en)[Key] extends string ? string : Widen<(typeof en)[Key]>
}

type Widen<Section> = { [Key in keyof Section]: string }
