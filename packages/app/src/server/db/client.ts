// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { Database } from 'bun:sqlite'
import { drizzle } from 'drizzle-orm/bun-sqlite'
import { migrate } from 'drizzle-orm/bun-sqlite/migrator'

export interface OpenDatabaseOptions {
	/** The SQLite file, created when missing, or ':memory:'. */
	path: string
	migrationsFolder: string
}

/**
 * Opens the database the way both the server and the specs use it: WAL, a busy timeout, every
 * pending migration applied, then foreign keys enforced.
 */
// oxlint-disable-next-line typescript/explicit-module-boundary-types -- The Drizzle client type is long; callers use Db.
export function openDatabase({ path, migrationsFolder }: OpenDatabaseOptions) {
	const sqlite = new Database(path, { create: true, strict: true })

	/* WAL lets pages read while the job runner writes. `synchronous` stays FULL: a saved note must
	 * survive a power cut, and one fsync per commit fits the 50 ms save budget. */
	sqlite.run('PRAGMA journal_mode = WAL')
	sqlite.run('PRAGMA busy_timeout = 5000')

	const db = drizzle({ client: sqlite })

	/* Migrations run in one transaction, where `PRAGMA foreign_keys` does nothing, so a table rebuild
	 * cannot turn the checks off itself. Run them with the checks off, then look for orphans. */
	migrate(db, { migrationsFolder })

	const violations = sqlite.query('PRAGMA foreign_key_check').all()

	if (violations.length > 0) {
		sqlite.close()
		throw new Error(`Migrations left foreign key violations: ${JSON.stringify(violations)}`)
	}

	sqlite.run('PRAGMA foreign_keys = ON')

	return { sqlite, db }
}

export type Db = ReturnType<typeof openDatabase>['db']
