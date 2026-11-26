// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { readyMessage } from '#/features/push/server/messages'
import { createPushSender, type PushSender } from '#/features/push/server/send'
import { readCardView } from '#/features/research/server/card-view'
import type { ReadyNote } from '#/features/research/server/engine-call'
import { config } from '#/server/config'
import type { Db } from '#/server/db/client'
import { instanceDb } from '#/server/db/instance'

/*
 * Web Push composed with research: the push feature never reads another feature, so this entry
 * module reads the saved card and writes the "Ready" notification for it. One sender per process
 * keeps each push service's signed header between notifications.
 */

let thisProcess: { db: Db; sender: PushSender } | undefined

/** The process's push sender; its VAPID subject is the source URL, never the instance's own name. */
export async function instancePushSender(): Promise<PushSender> {
	const db = await instanceDb()

	// Keyed on the database like the research job: specs swap it.
	if (thisProcess?.db !== db) {
		const sender = createPushSender({
			db,
			subject: config.sourceUrl,
			origin: config.publicOrigin,
		})

		thisProcess = { db, sender }
	}

	return thisProcess.sender
}

/* Nothing reads the progress board here: the job passes the pages it read, and the board is
 * cleared once the job ends. */
const noProgress = { get: () => null }

/**
 * The research jobs' `notify`: sends every subscribed browser "Ready" for the note's saved card, in
 * the browser's language. A note deleted since sends nothing.
 */
export function readyNotifier(db: Db): (ready: ReadyNote) => Promise<void> {
	return async ({ noteId, pagesRead }) => {
		const view = readCardView(db, noProgress, { noteId, now: new Date() })

		if (view === null) {
			return
		}

		const report =
			view.levelSet === 'report' ? { pages: pagesRead ?? null, minutes: view.readingMinutes } : null

		const input = {
			noteId,
			term: view.note.text,
			isPrivate: view.note.isPrivate,
			category: view.category?.name ?? null,
			report,
		}

		const sender = await instancePushSender()

		await sender.send((locale) => readyMessage(input, locale))
	}
}
