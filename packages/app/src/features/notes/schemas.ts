// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

/** What the notes API accepts: request bodies, the list's query string and the path id. */
import * as v from 'valibot'

import { noteStatuses } from '#/server/db/schema/notes'

/** Where a note was captured: the web app or the iOS Shortcut. */
export const noteSources = ['web', 'shortcut'] as const

const rowId = v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(Number.MAX_SAFE_INTEGER))

/** A row id in a path or a query string, without signs, leading zeros or anything a number would forgive. */
const rowIdText = v.pipe(
	v.string(),
	v.regex(/^[1-9]\d{0,14}$/u, 'Use a positive integer.'),
	v.transform(Number),
)

/** A note id from the path. */
export const noteIdSchema = rowIdText

function isWebUrl(value: string) {
	return URL.canParse(value) && ['http:', 'https:'].includes(new URL(value).protocol)
}

const noteText = v.pipe(
	v.string(),
	v.trim(),
	v.nonEmpty('Write the note.'),
	v.maxLength(1000, 'Use at most 1000 characters.'),
)

export const maxNoteContextLength = 4000

const contextText = v.pipe(
	v.string(),
	v.trim(),
	v.maxLength(maxNoteContextLength, `Use at most ${maxNoteContextLength} characters.`),
	// Blank context is no context.
	v.transform((value) => (value === '' ? null : value)),
)

const webUrl = v.pipe(
	v.string(),
	v.trim(),
	v.maxLength(2048, 'Use at most 2048 characters.'),
	v.check(isWebUrl, 'Use an http or https URL.'),
)

export const newNoteSchema = v.object({
	text: noteText,
	context: v.nullish(contextText, null),
	url: v.nullish(webUrl, null),
	source: v.optional(v.picklist(noteSources), 'web'),
	categoryId: v.nullish(rowId, null),
	private: v.optional(v.boolean(), false),
})

export type NewNote = v.InferOutput<typeof newNoteSchema>

const restore = v.literal(false, 'Send false to restore a note; delete it with DELETE.')

const changedCategory = v.nullable(rowId)

const noteStatus = v.picklist(noteStatuses)

/** A change to a note; a field left out keeps its value, and `categoryId: null` clears the category. */
export const noteChangeSchema = v.pipe(
	v.object({
		categoryId: v.optional(changedCategory),
		status: v.optional(noteStatus),
		deleted: v.optional(restore),
	}),
	v.check(
		({ categoryId, status, deleted }) =>
			[categoryId, status, deleted].some((value) => value !== undefined),
		'Change categoryId, status or deleted.',
	),
)

export type NoteChange = v.InferOutput<typeof noteChangeSchema>

export const defaultPageSize = 50

interface Cursor {
	readonly createdAt: number
	readonly id: number
}

const cursorPattern = /^\d{1,15}\.[1-9]\d{0,14}$/u

/* A cursor is the last listed note's creation time and id, as `<ms>.<id>` in base64url, so clients
 * treat it as opaque. */
export function encodeCursor({ createdAt, id }: { createdAt: Date; id: number }): string {
	return new TextEncoder()
		.encode(`${createdAt.getTime()}.${id}`)
		.toBase64({ alphabet: 'base64url', omitPadding: true })
}

function decodeCursor(value: string): Cursor | undefined {
	try {
		const bytes = Uint8Array.fromBase64(value, { alphabet: 'base64url' })
		const text = new TextDecoder().decode(bytes)

		if (!cursorPattern.test(text)) {
			return undefined
		}

		const separator = text.indexOf('.')

		return { createdAt: Number(text.slice(0, separator)), id: Number(text.slice(separator + 1)) }
	} catch {
		return undefined
	}
}

const cursor = v.pipe(
	v.string(),
	v.transform(decodeCursor),
	v.object({ createdAt: v.number(), id: v.number() }, 'Use the nextCursor of the previous page.'),
)

const pageSize = v.pipe(
	v.string(),
	v.regex(/^\d{1,3}$/u, 'Use a number from 1 to 100.'),
	v.transform(Number),
	v.minValue(1, 'Use a number from 1 to 100.'),
	v.maxValue(100, 'Use a number from 1 to 100.'),
)

/** The list's query string: filters, the cursor of the next page and the page size. */
export const notesQuerySchema = v.object({
	status: v.optional(noteStatus),
	categoryId: v.optional(rowIdText),
	cursor: v.optional(cursor),
	limit: v.optional(pageSize),
})

export type NotesQuery = v.InferOutput<typeof notesQuerySchema>
