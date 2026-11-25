// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import * as v from 'valibot'

import type { JsonFetch, SavedNote } from '../shared/types'
import type { SubmitMode } from './capture-model'
import { splitContext } from './split-context'

export interface CaptureDraft {
	readonly text: string
	/** The "where you saw it" field as typed. */
	readonly contextField: string
	readonly categoryId: number
	readonly private: boolean
}

export interface SubmitRequest {
	readonly mode: SubmitMode
	readonly draft: CaptureDraft
	/** For `deeper`: the note of the card shown before (`deeperNoteId` in the model). */
	readonly deeperNoteId?: number | null
}

export type SubmitResult =
	| {
			readonly kind: 'saved'
			readonly note: SavedNote
			/** False when the capture joined a saved note: deleting would delete that note. */
			readonly canUndo: boolean
			/** Research or deeper, started after the save; true once the server took it. */
			readonly followUp: Promise<boolean> | null
	  }
	/** 400: the first reason the server gave, for the term field. */
	| { readonly kind: 'invalid'; readonly message: string | null }
	| { readonly kind: 'unauthorized' }
	/** A network error or any other answer: the sheet keeps the note and offers to try again. */
	| { readonly kind: 'failed' }
	/** A save is in flight already. */
	| { readonly kind: 'busy' }

export interface CaptureApi {
	submit: (request: SubmitRequest) => Promise<SubmitResult>
	/** Deletes a note this sheet created; true when it is gone. */
	undo: (noteId: number) => Promise<boolean>
	readonly isSaving: boolean
}

export interface CaptureApiOptions {
	readonly fetch: JsonFetch
}

interface NoteBody {
	readonly text: string
	readonly context: string | null
	readonly url: string | null
	readonly categoryId: number
	readonly private: boolean
	readonly source: 'web'
}

type PostBody = NoteBody | { readonly now: true } | Readonly<Record<string, never>>

const id = v.pipe(v.number(), v.integer())

const savedNoteSchema = v.object({
	id,
	text: v.string(),
	categoryId: v.nullable(id),
	private: v.boolean(),
}) satisfies v.GenericSchema<unknown, SavedNote>

const issues = v.optional(v.array(v.string()))

const errorSchema = v.object({ error: v.object({ message: v.string(), issues }) })

async function postJson(fetch: JsonFetch, url: string, body: PostBody) {
	return fetch(url, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(body),
	})
}

async function parseBody<T>(response: Response, schema: v.GenericSchema<unknown, T>) {
	const parsed = v.safeParse(schema, await response.json().catch(() => null))

	return parsed.success ? parsed.output : null
}

/* The server writes each issue as `<field path>: <message>`; the sheet shows the message. */
async function invalidMessage(response: Response) {
	const body = await parseBody(response, errorSchema)
	const issue = body?.error.issues?.at(0)

	return issue === undefined ? (body?.error.message ?? null) : issue.replace(/^[^:]*:\s*/u, '')
}

/** Saves captures over `POST /api/notes` and starts research or deeper once a note is saved. */
export function createCaptureApi({ fetch }: CaptureApiOptions): CaptureApi {
	let isSaving = false
	const undoing = new Set<number>()

	async function followUp(url: string, body: PostBody) {
		try {
			const response = await postJson(fetch, url, body)

			return response.status === 200 || response.status === 202
		} catch {
			return false
		}
	}

	function startFollowUp(request: SubmitRequest, note: SavedNote): Promise<boolean> | null {
		if (request.mode === 'save') {
			return null
		}

		const deeperId = request.mode === 'deeper' ? (request.deeperNoteId ?? null) : null

		/* A seen match without a note or card to go deeper from still gets its new note researched. */
		return deeperId === null
			? followUp(`/api/notes/${note.id}/research`, {})
			: followUp(`/api/notes/${deeperId}/deeper`, { now: true })
	}

	async function save(request: SubmitRequest): Promise<SubmitResult> {
		const { text, contextField, categoryId, private: isPrivate } = request.draft
		let response: Response

		try {
			response = await postJson(fetch, '/api/notes', {
				text: text.trim(),
				...splitContext(contextField),
				categoryId,
				private: isPrivate,
				source: 'web',
			})
		} catch {
			return { kind: 'failed' }
		}

		if (response.status === 400) {
			return { kind: 'invalid', message: await invalidMessage(response) }
		}

		if (response.status === 401) {
			return { kind: 'unauthorized' }
		}

		const note = await parseBody(response, savedNoteSchema)

		if ((response.status !== 200 && response.status !== 201) || note === null) {
			return { kind: 'failed' }
		}

		return {
			kind: 'saved',
			note,
			canUndo: response.status === 201,
			followUp: startFollowUp(request, note),
		}
	}

	return {
		get isSaving() {
			return isSaving
		},
		async submit(request) {
			if (isSaving) {
				return { kind: 'busy' }
			}

			isSaving = true

			try {
				return await save(request)
			} finally {
				isSaving = false
			}
		},
		async undo(noteId) {
			if (undoing.has(noteId)) {
				return false
			}

			undoing.add(noteId)

			try {
				const response = await fetch(`/api/notes/${noteId}`, { method: 'DELETE' })

				return response.ok
			} catch {
				return false
			} finally {
				undoing.delete(noteId)
			}
		},
	}
}
