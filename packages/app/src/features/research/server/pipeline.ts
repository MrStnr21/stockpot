// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

/*
 * The research job: assemble the note's task, call the router, save the card and learn from it. The
 * other features it needs (notes, settings) and the runner come in as dependencies, because features
 * never import each other: src/instance.ts composes them.
 */
import { and, eq, inArray, isNull } from 'drizzle-orm'

import type { Db } from '#/server/db/client'
import { notes, type NoteStatus } from '#/server/db/schema/notes'
import { EngineError } from '#/server/engines/contract'
import type { Router } from '#/server/engines/router'
import type { Priority } from '#/server/jobs/queue'
import type { JobContext, JobDefinition } from '#/server/jobs/types'
import { log } from '#/server/log'

import { assemble, type ResearchTask } from './assemble'
import { save } from './save'

export interface ResearchPayload {
	noteId: number
}

/** What a first-level card tells about its term. */
export interface LearnedCard {
	readonly sense: string
	readonly aliases: readonly string[]
}

export interface ResearchDependencies {
	readonly db: Db
	readonly router: Pick<Router, 'explain' | 'research'>
	/** The card language from settings, read when a run starts. */
	readonly language: () => string
	/** Queues the same job again at `runAt`: a draft's redo, or a run after an engine's reset. */
	readonly later: (payload: ResearchPayload, runAt: Date) => void
	/** Records a card's sense and aliases on its term. */
	readonly learn: (termId: number, card: LearnedCard) => void
	readonly now?: () => Date
}

const maxAttempts = 3

// A reset that has already passed, or passes in a moment, still waits this long before the next call.
const shortestWaitMs = 60_000

// Statuses a failed run may change: ready and read keep a draft's redo visible, archived is the owner's.
const unfinished: NoteStatus[] = ['new', 'queued', 'researching', 'failed']

function setUnfinishedStatus(db: Db, noteId: number, status: NoteStatus) {
	db.update(notes)
		.set({ status })
		.where(and(eq(notes.id, noteId), inArray(notes.status, unfinished)))
		.run()
}

async function callRouter(
	router: ResearchDependencies['router'],
	{ categoryId, input }: ResearchTask,
	{ id, signal }: JobContext,
) {
	const options = { categoryId, signal, jobId: id }

	return input.task === 'research'
		? router.research(input, options)
		: router.explain(input, options)
}

function learnFrom(
	deps: ResearchDependencies,
	{ noteId, termId, card }: { noteId: number; termId: number; card: LearnedCard },
) {
	try {
		deps.learn(termId, { sense: card.sense, aliases: card.aliases })
	} catch (error) {
		// The card is saved and a term that learned nothing still works. Only names, never card text.
		log.warn('Learning from a card failed', {
			noteId,
			termId,
			name: error instanceof Error ? error.name : 'unknown',
		})
	}
}

/*
 * Settles the engine failures a retry cannot help with, and returns whether it did. A limit with no
 * engine left waits for its reset in a new job, so it spends no attempt; a rejected key needs the
 * owner.
 */
function settleEngineFailure(
	deps: ResearchDependencies,
	payload: ResearchPayload,
	error: EngineError,
): boolean {
	const { db, now = () => new Date() } = deps
	const { failure } = error

	if (failure.kind === 'rate_limited') {
		const soonest = now().getTime() + shortestWaitMs
		const runAt = new Date(Math.max(failure.resetsAt.getTime(), soonest))

		setUnfinishedStatus(db, payload.noteId, 'queued')
		deps.later(payload, runAt)

		return true
	}

	if (failure.kind === 'auth') {
		setUnfinishedStatus(db, payload.noteId, 'failed')
		log.warn('Research failed: the engine rejected its key', {
			noteId: payload.noteId,
			kind: failure.kind,
		})

		return true
	}

	return false
}

async function research(
	deps: ResearchDependencies,
	payload: ResearchPayload,
	context: JobContext,
): Promise<void> {
	const { db, language } = deps
	const { noteId } = payload

	try {
		const task = assemble(db, { noteId, language })

		if (task === null) {
			return
		}

		const result = await callRouter(deps.router, task, context)
		const saved = save(db, task, result)

		if (saved === null) {
			return
		}

		if (result.draft) {
			deps.later(payload, result.redoAt)
		}

		// Depth is always 1 here, so every card names its sense and aliases.
		if (saved.termId !== null) {
			learnFrom(deps, { noteId, termId: saved.termId, card: result.output })
		}
	} catch (error) {
		if (error instanceof EngineError && settleEngineFailure(deps, payload, error)) {
			return
		}

		// Anything else goes back to the runner, which retries it until the job's last attempt.
		setUnfinishedStatus(db, noteId, context.attempt < maxAttempts ? 'queued' : 'failed')

		throw error
	}
}

/** The `research` job: writes a note's first card. Its payload names the note, whatever its status. */
export function createResearchJob(deps: ResearchDependencies): JobDefinition<ResearchPayload> {
	return {
		kind: 'research',
		maxAttempts,
		// Just above the engine's own 15-minute research timeout, so that one fires first.
		timeout: 16 * 60_000,
		run: async (payload, context) => research(deps, payload, context),
	}
}

export interface QueueDependencies {
	readonly db: Db
	readonly enqueue: (payload: ResearchPayload, priority: Priority) => void
}

/*
 * Queues a research job per note, then marks the notes that wait for one. The jobs come first and
 * the handler accepts any status, so a crash between the two leaves no note queued without a job.
 */
export function queueResearch(
	{ db, enqueue }: QueueDependencies,
	noteIds: readonly number[],
	priority: Priority,
): void {
	for (const noteId of noteIds) {
		enqueue({ noteId }, priority)
	}

	if (noteIds.length === 0) {
		return
	}

	db.update(notes)
		.set({ status: 'queued' })
		.where(
			and(
				inArray(notes.id, [...noteIds]),
				isNull(notes.deletedAt),
				inArray(notes.status, ['new', 'failed']),
			),
		)
		.run()
}
