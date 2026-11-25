// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { createSuggester, type Suggester } from '#/features/capture/server/suggest'
import { createBatchJob } from '#/features/digest/server/batch'
import { learnAliases, learnSense } from '#/features/notes/server/learn'
import { createDeeperJob, type DeeperPayload } from '#/features/research/server/depth'
import type { ReadyNote } from '#/features/research/server/engine-call'
import { researchNow, type ResearchNowResult } from '#/features/research/server/now'
import { pendingResearchNoteIds } from '#/features/research/server/pending'
import {
	createResearchJob,
	priorityOf,
	queueResearch,
	type ResearchPayload,
} from '#/features/research/server/pipeline'
import { readSettings } from '#/features/settings/server'
import { config } from '#/server/config'
import type { Db } from '#/server/db/client'
import { instanceDb } from '#/server/db/instance'
import { createRouter, type Router } from '#/server/engines/router'
import { HttpError } from '#/server/http'
import { currentRunner } from '#/server/jobs/runner'
import type { JobDefinition, ScheduledRun } from '#/server/jobs/types'
import { openLink } from '#/server/links/open-link'
import { log } from '#/server/log'

/*
 * The process's shared services that are built from features: the router reads the settings feature,
 * the suggester belongs to capture, and the jobs compose digest, research, notes and settings.
 * server/ may not import features, so they live in this entry module, opened on first use like the database.
 * One router keeps each engine and Gemini's usage counters once per process; one suggester keeps one
 * cache; the runner accepts only the job definition it was started with.
 */

interface ProcessServices {
	router?: Promise<Router>
	suggester?: Suggester
	researchJob?: { db: Db; job: JobDefinition<ResearchPayload> }
	deeperJob?: { db: Db; job: JobDefinition<DeeperPayload> }
	batchJob?: Promise<JobDefinition<ScheduledRun>>
}

const thisProcess: ProcessServices = {}

export async function instanceRouter(): Promise<Router> {
	thisProcess.router ??= instanceDb().then((db) =>
		createRouter({
			db,
			settings: () => {
				const { engines, routing } = readSettings(db)

				return { engines, routing }
			},
			agentCommand: config.agentCommand,
		}),
	)

	return thisProcess.router
}

export async function instanceSuggester(): Promise<Suggester> {
	thisProcess.suggester ??= createSuggester({
		router: {
			async suggest(input, options) {
				const router = await instanceRouter()

				return router.suggest(input, options)
			},
		},
	})

	return thisProcess.suggester
}

function queueAgain<Payload extends { noteId: number; now?: true }>(
	job: JobDefinition<Payload>,
	payload: Payload,
	runAt: Date,
) {
	const runner = currentRunner()

	// Only the built server runs a runner (src/boot.ts); without one the note waits for the next queue.
	if (runner === undefined) {
		log.warn('No job runner to queue a job again', { noteId: payload.noteId })

		return
	}

	runner.enqueue(job, payload, { runAt, priority: priorityOf(payload) })
}

// WEB-6 replaces this stub with the push feature's sender.
function notifyReady({ noteId }: ReadyNote) {
	log.info('A research-now card is ready', { noteId })
}

function buildResearchJob(db: Db): JobDefinition<ResearchPayload> {
	const job = createResearchJob({
		db,
		router: {
			async explain(input, options) {
				const router = await instanceRouter()

				return router.explain(input, options)
			},
			async research(input, options) {
				const router = await instanceRouter()

				return router.research(input, options)
			},
		},
		openLink: async (url, signal) => openLink(url, { signal }),
		language: () => readSettings(db).cardLanguage,
		later: (payload, runAt) => {
			queueAgain(job, payload, runAt)
		},
		learn: (termId, { sense, aliases }) => {
			learnAliases(db, termId, aliases)
			learnSense(db, termId, sense)
		},
		notify: notifyReady,
	})

	return job
}

/** The research job src/boot.ts registers, and the one every enqueue must pass. */
export async function instanceResearchJob(): Promise<JobDefinition<ResearchPayload>> {
	const db = await instanceDb()

	// Keyed on the database: a process has one, but specs swap it and must not get a job over the last one.
	if (thisProcess.researchJob?.db !== db) {
		thisProcess.researchJob = { db, job: buildResearchJob(db) }
	}

	return thisProcess.researchJob.job
}

function buildDeeperJob(db: Db): JobDefinition<DeeperPayload> {
	const job = createDeeperJob({
		db,
		router: {
			async explain(input, options) {
				const router = await instanceRouter()

				return router.explain(input, options)
			},
			async research(input, options) {
				const router = await instanceRouter()

				return router.research(input, options)
			},
		},
		openLink: async (url, signal) => openLink(url, { signal }),
		language: () => readSettings(db).cardLanguage,
		later: (payload, runAt) => {
			queueAgain(job, payload, runAt)
		},
		notify: notifyReady,
	})

	return job
}

/** The deeper job src/boot.ts registers, and the one every enqueue must pass. */
export async function instanceDeeperJob(): Promise<JobDefinition<DeeperPayload>> {
	const db = await instanceDb()

	// Keyed on the database like the research job.
	if (thisProcess.deeperJob?.db !== db) {
		thisProcess.deeperJob = { db, job: buildDeeperJob(db) }
	}

	return thisProcess.deeperJob.job
}

/**
 * Queues research with the `now` priority for the notes, as the research-now routes ask. Without a
 * running job runner (the dev server) it answers 503 before it writes anything.
 */
export async function instanceResearchNow(
	noteIds: readonly number[],
): Promise<ResearchNowResult[]> {
	const [db, job] = await Promise.all([instanceDb(), instanceResearchJob()])
	const runner = currentRunner()

	if (runner === undefined) {
		throw new HttpError(503, {
			code: 'jobs_unavailable',
			message: 'The job runner is not running. Try again in a moment.',
		})
	}

	return researchNow(
		{
			db,
			enqueue: (payload, priority) => {
				runner.enqueue(job, payload, { priority })
			},
		},
		noteIds,
	)
}

function buildBatchJob(
	db: Db,
	researchJob: JobDefinition<ResearchPayload>,
): JobDefinition<ScheduledRun> {
	return createBatchJob({
		db,
		pending: () => pendingResearchNoteIds(db),
		queue: (noteIds) => {
			const runner = currentRunner()

			if (runner === undefined) {
				log.warn('No job runner to queue the nightly batch', { notes: noteIds.length })

				return
			}

			const runAt = new Date()

			queueResearch(
				{
					db,
					enqueue: (payload, priority) => {
						runner.enqueue(researchJob, payload, { priority, runAt })
					},
				},
				noteIds,
				'batch',
			)
		},
	})
}

/** The nightly batch job src/boot.ts registers as a daily schedule. */
export async function instanceBatchJob(): Promise<JobDefinition<ScheduledRun>> {
	thisProcess.batchJob ??= Promise.all([instanceDb(), instanceResearchJob()]).then(
		([db, researchJob]) => buildBatchJob(db, researchJob),
	)

	return thisProcess.batchJob
}
