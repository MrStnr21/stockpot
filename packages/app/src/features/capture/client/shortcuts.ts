// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

/** The parts of a `KeyboardEvent` the shortcuts read, so they can be checked without a DOM. */
export interface ShortcutKey {
	readonly key: string
	readonly code: string
	readonly metaKey: boolean
	readonly ctrlKey: boolean
	readonly altKey: boolean
	readonly shiftKey: boolean
	readonly repeat: boolean
	readonly isComposing: boolean
	readonly defaultPrevented: boolean
}

export interface ShortcutTarget {
	readonly tagName?: string
	readonly isContentEditable?: boolean
}

const editableTags = new Set(['INPUT', 'TEXTAREA', 'SELECT'])

function isEditable(target: ShortcutTarget | null) {
	return (
		target !== null &&
		(editableTags.has(target.tagName?.toUpperCase() ?? '') || target.isContentEditable === true)
	)
}

/**
 * ⌘↩ or Ctrl+Enter saves and ⇧⌘↩ researches now, inside the sheet. A held key repeats the event,
 * and Enter that ends an IME composition is not a submit.
 */
export function sheetShortcut(event: ShortcutKey): 'save' | 'research' | null {
	if (
		event.key !== 'Enter' ||
		!(event.metaKey || event.ctrlKey) ||
		event.altKey ||
		event.repeat ||
		event.isComposing ||
		event.defaultPrevented
	) {
		return null
	}

	return event.shiftKey ? 'research' : 'save'
}

/*
 * N opens the sheet. On a layout without Latin letters, such as Russian, the key reports its own
 * letter, so the physical N key counts there.
 */
function isN({ key, code }: ShortcutKey) {
	return /^[a-z]$/iu.test(key) ? key.toLowerCase() === 'n' : code === 'KeyN'
}

/** N with no modifier, outside a text field, while no dialog is open. */
export function opensSheet(
	event: ShortcutKey,
	target: ShortcutTarget | null,
	isDialogOpen: boolean,
): boolean {
	return (
		isN(event) &&
		!event.metaKey &&
		!event.ctrlKey &&
		!event.altKey &&
		!event.shiftKey &&
		!event.repeat &&
		!event.isComposing &&
		!event.defaultPrevented &&
		!isDialogOpen &&
		!isEditable(target)
	)
}

/** Apple keyboards show ⌘; elsewhere the hints read Ctrl. */
export function isApplePlatform(userAgent: string): boolean {
	return /Mac|iPhone|iPad/u.test(userAgent)
}

export interface ClickLike {
	readonly button: number
	readonly metaKey: boolean
	readonly ctrlKey: boolean
	readonly altKey: boolean
	readonly shiftKey: boolean
	readonly defaultPrevented: boolean
}

/** A primary click with no modifier: one a link would follow in the same tab. */
export function isPlainClick(event: ClickLike): boolean {
	return (
		event.button === 0 &&
		!event.metaKey &&
		!event.ctrlKey &&
		!event.altKey &&
		!event.shiftKey &&
		!event.defaultPrevented
	)
}
