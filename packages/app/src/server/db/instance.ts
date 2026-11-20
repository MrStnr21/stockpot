// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { $ } from 'bun'
import { join } from 'node:path'

import { config } from '#/server/config'

import { openDatabase, type Db } from './client'

/*
 * Next to this module: in the source folder, and in the build, where astro.config.ts copies the
 * migrations next to the chunk that holds this module.
 */
const migrationsFolder = join(import.meta.dirname, 'migrations')

/** The database this process opened, if it has. */
interface ProcessDatabase {
	db?: Promise<Db>
}

const thisProcess: ProcessDatabase = {}

async function open() {
	await $`mkdir -p ${config.dataDir}`.quiet()

	const { db } = await openDatabase({ path: join(config.dataDir, 'stockpot.db'), migrationsFolder })

	return db
}

/**
 * The database of this instance, `stockpot.db` in the data directory, opened on first use and shared
 * by everything in the process. src/boot.ts opens it at startup, so a failed migration stops the
 * server before it takes a request.
 */
export async function instanceDb(): Promise<Db> {
	thisProcess.db ??= open()

	return thisProcess.db
}
