// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { file, write } from 'bun'
import { Database } from 'bun:sqlite'
import { drizzle } from 'drizzle-orm/bun-sqlite'
import { migrate } from 'drizzle-orm/bun-sqlite/migrator'
import { readMigrationFiles } from 'drizzle-orm/migrator'
import { getMigrationsToRun } from 'drizzle-orm/migrator.utils'

export interface OpenDatabaseOptions {
	/** The SQLite file, created when missing, or ':memory:'. */
	path: string
	migrationsFolder: string
}

interface AppliedMigration {
	id: number
	hash: string
	created_at: string
	name: string | null
}

// The table drizzle's migrator records applied migrations in.
const migrationLog = '__drizzle_migrations'

/** The migrations drizzle's migrator would apply to this database, worked out with its own helpers. */
function pendingMigrations(sqlite: Database, migrationsFolder: string) {
	const hasLog =
		sqlite
			.query('SELECT 1 FROM sqlite_schema WHERE type = ? AND name = ?')
			.get('table', migrationLog) !== null

	const dbMigrations = hasLog
		? sqlite
				.query<AppliedMigration, []>(`SELECT id, hash, created_at, name FROM ${migrationLog}`)
				.all()
		: []

	return getMigrationsToRun({
		localMigrations: readMigrationFiles({ migrationsFolder }),
		dbMigrations,
	})
}

async function removeFile(path: string) {
	const target = file(path)

	if (await target.exists()) {
		await target.delete()
	}
}

/**
 * Applies the pending migrations with foreign keys off, then looks for orphans. Migrations run in one
 * transaction, where `PRAGMA foreign_keys` does nothing, so a table rebuild cannot turn the checks off
 * itself; and drizzle commits before the check can run. A file is therefore copied first, and put back
 * when the check fails, so a bad migration leaves the instance as it was instead of unable to start.
 */
async function migrateWithBackup(sqlite: Database, path: string, migrationsFolder: string) {
	const backup = path === ':memory:' ? undefined : `${path}.pre-migration`

	if (backup !== undefined) {
		// A copy left by a process that stopped mid-migration would make VACUUM INTO fail.
		await removeFile(backup)
		sqlite.run('VACUUM INTO ?', [backup])
	}

	sqlite.run('PRAGMA foreign_keys = OFF')

	try {
		migrate(drizzle({ client: sqlite }), { migrationsFolder })
	} catch (error) {
		// Drizzle rolled the transaction back, so the file is unchanged.
		sqlite.close()

		if (backup !== undefined) {
			await removeFile(backup)
		}

		throw error
	}

	const violations = sqlite.query('PRAGMA foreign_key_check').all()

	if (violations.length > 0) {
		sqlite.close()

		if (backup !== undefined) {
			await Promise.all([removeFile(`${path}-wal`), removeFile(`${path}-shm`)])
			await write(path, file(backup))
			await removeFile(backup)
		}

		throw new Error(
			`Migrations left foreign key violations, so the database was put back as it was: ${JSON.stringify(violations)}`,
		)
	}

	if (backup !== undefined) {
		await removeFile(backup)
	}
}

/**
 * Opens the database the way both the server and the specs use it: WAL, a busy timeout, every
 * pending migration applied, then foreign keys enforced.
 */
// oxlint-disable-next-line typescript/explicit-module-boundary-types -- The Drizzle client type is long; callers use Db.
export async function openDatabase({ path, migrationsFolder }: OpenDatabaseOptions) {
	const sqlite = new Database(path, { create: true, strict: true })

	/* WAL lets pages read while the job runner writes. `synchronous` stays FULL: a saved note must
	 * survive a power cut, and one fsync per commit fits the 50 ms save budget. */
	sqlite.run('PRAGMA journal_mode = WAL')
	sqlite.run('PRAGMA busy_timeout = 5000')

	if (pendingMigrations(sqlite, migrationsFolder).length > 0) {
		await migrateWithBackup(sqlite, path, migrationsFolder)
	}

	sqlite.run('PRAGMA foreign_keys = ON')

	return { sqlite, db: drizzle({ client: sqlite }) }
}

export type Db = Awaited<ReturnType<typeof openDatabase>>['db']
