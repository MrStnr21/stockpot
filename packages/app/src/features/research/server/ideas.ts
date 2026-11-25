// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

/*
 * Where the research of an idea stands while its job runs (docs/engines.md, "Progress"). A report
 * takes minutes, so the owner may watch its steps. The board holds counts only, never a question, a
 * finding or a link, in memory and once per process: a restart loses it, and the job that was running
 * starts again anyway.
 */
import { and, eq, isNull } from 'drizzle-orm'

import type { Db } from '#/server/db/client'
import { notes, type NoteStatus } from '#/server/db/schema/notes'
import type { ResearchProgress } from '#/server/engines/contract'

export interface ProgressBoard {
	/** Replaces the note's progress with the four counts of `progress`. */
	readonly set: (noteId: number, progress: ResearchProgress) => void
	readonly clear: (noteId: number) => void
	/** The note's progress, or `null` when its idea is not being researched now. */
	readonly get: (noteId: number) => ResearchProgress | null
}

export function createProgressBoard(): ProgressBoard {
	const entries = new Map<number, ResearchProgress>()

	return {
		set(noteId, { step, questions, searched, pages }) {
			entries.set(noteId, { step, questions, searched, pages })
		},
		clear(noteId) {
			entries.delete(noteId)
		},
		get(noteId) {
			return entries.get(noteId) ?? null
		},
	}
}

/**
 * The callback that puts an engine's progress on the board, or `undefined` without a board. It
 * ignores calls once the job's signal has aborted: the worker leaves a timed-out handler running, and
 * it must not write over the retry's progress.
 */
export function progressReporter(
	board: ProgressBoard | undefined,
	noteId: number,
	signal: AbortSignal,
): ((progress: ResearchProgress) => void) | undefined {
	if (board === undefined) {
		return undefined
	}

	return (progress) => {
		if (!signal.aborted) {
			board.set(noteId, progress)
		}
	}
}

/** What `GET /api/notes/:id/research` answers. */
export interface ResearchState {
	readonly id: number
	readonly status: NoteStatus
	readonly progress: ResearchProgress | null
}

/** A note's status and its idea's progress; `null` for a note that is missing or deleted. */
export function researchState(db: Db, board: ProgressBoard, noteId: number): ResearchState | null {
	const note = db
		.select({ id: notes.id, status: notes.status })
		.from(notes)
		.where(and(eq(notes.id, noteId), isNull(notes.deletedAt)))
		.get()

	return note === undefined ? null : { ...note, progress: board.get(noteId) }
}
