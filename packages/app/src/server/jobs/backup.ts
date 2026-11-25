// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { $, Glob } from 'bun'
import { join } from 'node:path'
import { sql } from 'drizzle-orm'

import type { Db } from '#/server/db/client'
import { log } from '#/server/log'

import type { JobDefinition, ScheduledRun } from './types'

export interface BackupDependencies {
	readonly db: Db
	/** The folder the backups go in; created when missing. */
	readonly directory: string
	/** How many daily backups stay; the oldest go first. */
	readonly keep: number
}

/** A day's backup is `stockpot-2026-11-24.db`; retention touches only names of this shape. */
const backupName = /^stockpot-\d{4}-\d{2}-\d{2}\.db$/u

async function removeFile(path: string) {
	// `rm -f` instead of check-then-delete: two runs of one row may overlap (see the jobs README).
	await $`rm -f ${path}`.quiet()
}

/**
 * Copies the database into `<day>`'s file, then drops the backups beyond the newest `keep`, never the
 * one just written. The copy is built under a temporary name and renamed once complete, so a crash
 * of the process or a full disk never leaves a half-written file that retention would count as a good
 * backup; a power cut can still lose the newest copy, as SQLite does not flush it, and the earlier
 * ones stay. The backup holds the engine keys as plain text, as the database does, so the folder and
 * the file are readable by the owner only.
 *
 * The copy runs on the app's only connection, so the server answers nothing until it ends: seconds
 * for a large database, at an hour when no one is using it.
 */
async function backUp({ db, directory, keep }: BackupDependencies, day: string) {
	// The day becomes part of a path, so only a date may pass.
	if (!/^\d{4}-\d{2}-\d{2}$/u.test(day)) {
		throw new Error(`Not a date to back up: ${day}`)
	}

	const name = `stockpot-${day}.db`
	const target = join(directory, name)
	const partial = `${target}.partial`

	await $`mkdir -p ${directory} && chmod 700 ${directory}`.quiet()
	// A copy left by a run that stopped midway would make VACUUM INTO fail.
	await removeFile(partial)

	try {
		// VACUUM INTO reads a consistent snapshot, so notes saved during the copy cannot tear it.
		db.run(sql`VACUUM INTO ${partial}`)

		// VACUUM INTO refuses an existing file, so the 700 folder keeps the copy private until here.
		await $`chmod 600 ${partial} && mv -f ${partial} ${target}`.quiet()
	} catch (error) {
		await removeFile(partial)

		throw error
	}

	const others = [...new Glob('stockpot-*.db').scanSync({ cwd: directory })]
		.filter((candidate) => backupName.test(candidate) && candidate !== name)
		.toSorted()
		.toReversed()

	const stale = others.slice(keep - 1)

	await Promise.all(stale.map(async (old) => removeFile(join(directory, old))))

	return others.length - stale.length + 1
}

export function createBackupJob(dependencies: BackupDependencies): JobDefinition<ScheduledRun> {
	// Retention removes backups, so a count that keeps none must not get that far.
	if (!Number.isInteger(dependencies.keep) || dependencies.keep < 1) {
		throw new Error(`Backups to keep must be a whole number from 1: ${dependencies.keep}`)
	}

	return {
		kind: 'daily-backup',
		async run({ day }, { signal }) {
			signal.throwIfAborted()

			const kept = await backUp(dependencies, day)

			log.info('Backed up the database', { day, kept })
		},
	}
}
