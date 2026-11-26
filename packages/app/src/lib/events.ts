// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

/*
 * Events one island sends on `globalThis` for another on the same page, since features never import
 * each other.
 */

/** A note was saved, or an Undo removed one: a list on the page loads its first page again. */
export const notesChangedEvent = 'stockpot:notes-changed'
